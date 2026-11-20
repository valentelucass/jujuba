use super::NoSqlSession;
use crate::db_monitor::{Activity, DatabaseMonitor, Indicator, Memory, ObjectActivity};
use crate::error::Result;
use futures_util::TryStreamExt;
use mongodb::{
    bson::{doc, Bson, Document},
    error::ErrorKind,
};
use std::collections::{BTreeMap, HashMap};
use std::time::Duration;

fn number(doc: &Document, field: &str) -> Option<u64> {
    match doc.get(field)? {
        Bson::Int32(n) => (*n).try_into().ok(),
        Bson::Int64(n) => (*n).try_into().ok(),
        Bson::Double(n) if n.is_finite() && *n >= 0.0 && *n < u64::MAX as f64 => Some(*n as u64),
        _ => None,
    }
}

fn metric(label: &str, value: u64, unit: &str, scope: &str) -> Indicator {
    Indicator {
        label: label.into(),
        value,
        unit: unit.into(),
        scope: scope.into(),
    }
}

fn field(doc: &Document, key: &str) -> Option<String> {
    doc.get_str(key)
        .ok()
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(160).collect())
}

fn mongo_memory(report: &mut DatabaseMonitor, status: &Document) {
    let resident = status
        .get_document("mem")
        .ok()
        .and_then(|d| number(d, "resident"))
        .and_then(|mib| mib.checked_mul(1 << 20));
    let cache = status
        .get_document("wiredTiger")
        .ok()
        .and_then(|d| d.get_document("cache").ok());
    if let Some(cache) = cache {
        report.memory = Memory {
            label: "Cache WiredTiger em uso".into(),
            scope: "Instância MongoDB".into(),
            used_bytes: number(cache, "bytes currently in the cache"),
            limit_bytes: number(cache, "maximum bytes configured"),
            limit_label: "Teto do cache WiredTiger".into(),
            ..Default::default()
        };
        if let Some(n) = resident {
            report.indicators.push(metric(
                "RAM residente do processo",
                n,
                "bytes",
                "Instância MongoDB",
            ));
        }
    } else {
        report.memory.used_bytes = resident;
    }
    if let Some(n) = status
        .get_document("connections")
        .ok()
        .and_then(|d| number(d, "current"))
    {
        report
            .indicators
            .push(metric("Conexões abertas", n, "count", "Instância MongoDB"));
    }
}

async fn mongo_activity(
    client: &mongodb::Client,
    db: &str,
    all: bool,
) -> mongodb::error::Result<Vec<Document>> {
    // Project only command names and collection metadata. Filter values and documents stay on the server.
    client.database("admin").aggregate([
        doc! { "$currentOp": { "allUsers": all, "idleConnections": false } },
        doc! { "$match": { "active": true, "command.comment": { "$ne": "jujuba-db-monitor" },
            "$expr": { "$eq": [{ "$indexOfCP": [{ "$ifNull": ["$ns", ""] }, { "$literal": format!("{db}.") }] }, 0] } } },
        doc! { "$limit": 51 },
        doc! { "$project": { "_id": 0, "opid": 1, "appName": 1, "client": 1, "ns": 1, "op": 1,
            "secs_running": 1, "waitingForLock": 1, "app": "$clientMetadata.application.name",
            "verb": { "$arrayElemAt": [{ "$map": { "input": { "$objectToArray": { "$ifNull": ["$command", {}] } }, "as": "f", "in": "$$f.k" } }, 0] } } },
    ]).comment(Bson::String("jujuba-db-monitor".into())).max_time(Duration::from_secs(3)).await?
        .try_collect().await
}

async fn mongo(client: &mongodb::Client, db: &str) -> Result<DatabaseMonitor> {
    let mut report = DatabaseMonitor {
        memory: Memory {
            label: "RAM residente do processo".into(),
            scope: "Instância MongoDB".into(),
            ..Default::default()
        },
        ..Default::default()
    };
    match client
        .database("admin")
        .run_command(doc! {
            "serverStatus": 1, "metrics": 0, "locks": 0, "repl": 0, "tcmalloc": 0, "maxTimeMS": 3000
        })
        .await
    {
        Ok(status) => mongo_memory(&mut report, &status),
        Err(_) => report
            .notes
            .push("O MongoDB não disponibilizou serverStatus para esta conexão.".into()),
    }
    let rows = match mongo_activity(client, db, true).await {
        Err(e) if matches!(&*e.kind, ErrorKind::Command(c) if c.code == 13) => {
            report
                .notes
                .push("A lista de operações está limitada ao usuário conectado.".into());
            mongo_activity(client, db, false).await
        }
        other => other,
    };
    match rows {
        Ok(rows) => {
            let mut objects = BTreeMap::<String, u64>::new();
            if rows.len() > 50 {
                report
                    .notes
                    .push("Amostra limitada a 50 operações simultâneas no banco.".into());
            }
            for (i, row) in rows.into_iter().take(50).enumerate() {
                let object = row
                    .get_str("ns")
                    .ok()
                    .and_then(|ns| ns.strip_prefix(db))
                    .and_then(|ns| ns.strip_prefix('.'))
                    .filter(|ns| !ns.is_empty() && !ns.starts_with('$'))
                    .map(|ns| ns.chars().take(255).collect::<String>());
                if let Some(name) = &object {
                    *objects.entry(name.to_owned()).or_default() += 1;
                }
                report.activity.push(Activity {
                    database: None,
                    last_request_end: None,
                    id: number(&row, "opid")
                        .map(|n| n.to_string())
                        .or_else(|| field(&row, "opid"))
                        .unwrap_or_else(|| format!("op-{}", i + 1)),
                    application: field(&row, "appName").or_else(|| field(&row, "app")),
                    client: field(&row, "client"),
                    operation: field(&row, "verb").or_else(|| field(&row, "op")),
                    object,
                    state: Some(
                        if row.get_bool("waitingForLock") == Ok(true) {
                            "Aguardando bloqueio"
                        } else {
                            "Em execução"
                        }
                        .into(),
                    ),
                    elapsed_ms: number(&row, "secs_running").and_then(|n| n.checked_mul(1000)),
                });
            }
            report.objects = objects
                .into_iter()
                .map(|(name, value)| ObjectActivity {
                    usage: None,
                    name,
                    value,
                    metric: "Operações em execução".into(),
                    unit: "count".into(),
                    window: "Nesta amostra".into(),
                })
                .collect();
            report.objects.sort_by(|a, b| b.value.cmp(&a.value));
        }
        Err(_) => report.notes.push(
            "As operações em execução estão indisponíveis para esta conta ou implantação.".into(),
        ),
    }
    Ok(report)
}

fn redis_memory(report: &mut DatabaseMonitor, raw: &str) -> Option<u64> {
    let fields: HashMap<_, _> = raw
        .lines()
        .filter_map(|line| line.split_once(':'))
        .collect();
    let get = |key: &str| fields.get(key).and_then(|s| s.trim().parse::<u64>().ok());
    let used = get("used_memory");
    let limit = get("maxmemory");
    let excluded = get("mem_not_counted_for_evict");
    if let (Some(bytes), Some(omit), Some(cap)) = (used, excluded, limit.filter(|v| *v > 0)) {
        report.memory = Memory {
            label: "Memória contabilizada para maxmemory".into(),
            scope: "Instância Redis".into(),
            used_bytes: bytes.checked_sub(omit),
            limit_bytes: Some(cap),
            limit_label: "maxmemory".into(),
            ..Default::default()
        };
        if let Some(peak) = get("used_memory_peak") {
            report.indicators.push(metric(
                "Pico de memória alocada",
                peak,
                "bytes",
                "Instância Redis · histórico do motor",
            ));
        }
        report.indicators.push(metric(
            "Memória alocada total",
            bytes,
            "bytes",
            "Instância Redis",
        ));
        report.indicators.push(metric(
            "Excluída de maxmemory",
            omit,
            "bytes",
            "Buffers de persistência e replicação",
        ));
    } else {
        report.memory.used_bytes = used;
        report.memory.native_peak_bytes = get("used_memory_peak");
        report.memory.native_peak_label = "Pico de alocação registrado pelo Redis".into();
        if let Some(cap) = limit {
            if cap == 0 {
                report
                    .notes
                    .push("O Redis está configurado sem limite maxmemory.".into());
            } else {
                report.indicators.push(metric(
                    "maxmemory configurado",
                    cap,
                    "bytes",
                    "Instância Redis",
                ));
            }
        }
    }
    for (key, label, unit) in [
        ("used_memory_rss", "RAM residente do processo", "bytes"),
        ("connected_clients", "Clientes conectados", "count"),
        ("blocked_clients", "Clientes bloqueados", "count"),
        (
            "evicted_keys",
            "Chaves removidas por pressão de memória",
            "count",
        ),
    ] {
        if let Some(n) = get(key) {
            report
                .indicators
                .push(metric(label, n, unit, "Instância Redis"));
        }
    }
    get("connected_clients")
}

fn redis_clients(report: &mut DatabaseMonitor, raw: &str, db: &str, observer: Option<u64>) {
    let selected = db.strip_prefix("db").and_then(|s| s.parse::<u64>().ok());
    if selected.is_none() {
        return;
    }
    for line in raw.lines() {
        let fields: HashMap<_, _> = line
            .split_ascii_whitespace()
            .filter_map(|field| field.split_once('='))
            .collect();
        let value = |key: &str| fields.get(key).copied().filter(|s| !s.is_empty());
        let Some(id) = value("id") else { continue };
        if value("db").and_then(|d| d.parse::<u64>().ok()) != selected
            || id.parse::<u64>().ok() == observer
            || (observer.is_none() && value("cmd") == Some("client|list"))
        {
            continue;
        }
        if report.activity.len() == 50 {
            report
                .notes
                .push("Exibindo até 50 clientes ligados ao banco lógico selecionado.".into());
            break;
        }
        report.activity.push(Activity {
            database: None,
            last_request_end: None,
            id: id.into(),
            application: value("name")
                .or_else(|| value("lib-name"))
                .map(|s| s.chars().take(160).collect()),
            client: value("addr").map(str::to_owned),
            operation: value("cmd").map(|s| s.chars().take(80).collect()),
            state: Some(
                if value("flags").is_some_and(|s| s.contains('b')) {
                    "Bloqueado"
                } else {
                    "Conectado"
                }
                .into(),
            ),
            ..Default::default()
        });
    }
}

async fn redis(manager: &redis::aio::ConnectionManager, db: &str) -> Result<DatabaseMonitor> {
    let mut conn = manager.clone();
    let mut report = DatabaseMonitor {
        memory: Memory {
            label: "Memória alocada".into(),
            scope: "Instância Redis".into(),
            ..Default::default()
        },
        ..Default::default()
    };
    let clients = match redis::cmd("INFO").query_async::<String>(&mut conn).await {
        Ok(raw) => redis_memory(&mut report, &raw),
        Err(_) => {
            report
                .notes
                .push("O Redis não disponibilizou os indicadores de INFO nesta conexão.".into());
            None
        }
    };
    if let Ok(n) = redis::cmd("DBSIZE").query_async::<u64>(&mut conn).await {
        report.indicators.push(metric(
            "Chaves no banco",
            n,
            "count",
            "Banco lógico selecionado",
        ));
    }
    if clients.is_some_and(|n| n > 5000) {
        report.notes.push("A lista de clientes foi omitida acima de 5.000 conexões para evitar percorrer todas a cada amostra.".into());
    } else {
        let observer = redis::cmd("CLIENT")
            .arg("ID")
            .query_async::<u64>(&mut conn)
            .await
            .ok();
        match redis::cmd("CLIENT")
            .arg("LIST")
            .query_async::<String>(&mut conn)
            .await
        {
            Ok(raw) => redis_clients(&mut report, &raw, db, observer),
            Err(_) => report
                .notes
                .push("O Redis não disponibilizou CLIENT LIST nesta conexão.".into()),
        }
    }
    report.notes.push("O Redis informa o último comando de cada cliente. A memória é da instância; o motor não identifica a chave em uso por esta amostra.".into());
    Ok(report)
}

pub(crate) async fn collect(session: &NoSqlSession, database: &str) -> Result<DatabaseMonitor> {
    match session {
        NoSqlSession::Mongo(client) => mongo(client, database).await,
        NoSqlSession::Redis(manager) => redis(manager, database).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redis_compares_eviction_memory_and_filters_logical_clients() {
        let mut report = DatabaseMonitor::default();
        redis_memory(&mut report, "used_memory:80\r\nmaxmemory:100\r\nmem_not_counted_for_evict:5\r\nused_memory_peak:90\r\n");
        assert_eq!(report.memory.used_bytes, Some(75));
        assert_eq!(report.memory.limit_bytes, Some(100));
        assert!(report.memory.native_peak_bytes.is_none());
        redis_clients(&mut report,"id=1 db=0 name=web cmd=get flags=N\nid=2 db=1 name=other cmd=set flags=N\nid=4 db=0 name=observer cmd=client|list flags=N","db0",Some(4));
        assert_eq!(report.activity.len(), 1);
        assert_eq!(report.activity[0].application.as_deref(), Some("web"));
    }

    #[test]
    fn mongo_cache_is_compared_only_to_its_own_ceiling() {
        let mut report = DatabaseMonitor::default();
        mongo_memory(
            &mut report,
            &doc! {"mem":{"resident":100i32}, "wiredTiger":{"cache":{"bytes currently in the cache":128i64,"maximum bytes configured":512i64}}},
        );
        assert_eq!(report.memory.used_bytes, Some(128));
        assert_eq!(report.memory.limit_bytes, Some(512));
        assert!(report.indicators.iter().any(|m| m.value == 100 * (1 << 20)));
    }

    #[tokio::test]
    #[ignore = "requer MongoDB de QA na porta JUJUBA_TEST_MONITOR_MONGO_PORT"]
    async fn live_mongo_monitor() {
        let port: u16 = std::env::var("JUJUBA_TEST_MONITOR_MONGO_PORT")
            .unwrap()
            .parse()
            .unwrap();
        let client = mongodb::Client::with_uri_str(format!(
            "mongodb://127.0.0.1:{port}/?serverSelectionTimeoutMS=5000"
        ))
        .await
        .unwrap();
        let report = mongo(&client, "jujuba_monitor_qa").await.unwrap();
        assert!(report.memory.used_bytes.is_some() && report.memory.limit_bytes.unwrap() > 0);
        assert!(report.notes.is_empty(), "{:?}", report.notes);
    }
    #[tokio::test]
    #[ignore = "requer Redis de QA na porta JUJUBA_TEST_MONITOR_REDIS_PORT"]
    async fn live_redis_monitor() {
        let port: u16 = std::env::var("JUJUBA_TEST_MONITOR_REDIS_PORT")
            .unwrap()
            .parse()
            .unwrap();
        let client = redis::Client::open(format!("redis://127.0.0.1:{port}/0")).unwrap();
        let manager = client.get_connection_manager().await.unwrap();
        let mut observer = client.get_multiplexed_async_connection().await.unwrap();
        redis::cmd("CLIENT")
            .arg("SETNAME")
            .arg("JUJUBA-QA")
            .query_async::<()>(&mut observer)
            .await
            .unwrap();
        let report = redis(&manager, "db0").await.unwrap();
        assert!(report.memory.used_bytes.unwrap() > 0);
        assert!(report
            .activity
            .iter()
            .any(|a| a.application.as_deref() == Some("JUJUBA-QA")));
    }
}
