use crate::{
    db_monitor::{Activity, DatabaseMonitor, Indicator, Memory, ObjectActivity},
    error::Result,
};
use sqlx::MySqlPool;
use std::collections::HashMap;

const INSTANCE: &str = "Instância MySQL";
const DATABASE: &str = "Banco selecionado";

const SESSIONS: &str = "SELECT CAST(t.PROCESSLIST_ID AS CHAR),
    COALESCE(NULLIF(p.ATTR_VALUE,''),NULLIF(d.ATTR_VALUE,'')), t.PROCESSLIST_HOST,
    COALESCE(UPPER(SUBSTRING_INDEX(e.EVENT_NAME,'/',-1)),t.PROCESSLIST_COMMAND),
    COALESCE(NULLIF(t.PROCESSLIST_STATE,''),t.PROCESSLIST_COMMAND),
    CASE WHEN w.OBJECT_NAME IS NOT NULL THEN CONCAT(w.OBJECT_SCHEMA,'.',w.OBJECT_NAME) END,
    CASE WHEN t.PROCESSLIST_COMMAND <> 'Sleep' THEN CAST(t.PROCESSLIST_TIME AS UNSIGNED)*1000 END
    FROM performance_schema.threads t
    LEFT JOIN performance_schema.session_connect_attrs p ON p.PROCESSLIST_ID=t.PROCESSLIST_ID AND p.ATTR_NAME='program_name'
    LEFT JOIN performance_schema.session_connect_attrs d ON d.PROCESSLIST_ID=t.PROCESSLIST_ID AND d.ATTR_NAME='_client_name'
    LEFT JOIN performance_schema.events_statements_current e ON e.THREAD_ID=t.THREAD_ID AND e.END_EVENT_ID IS NULL
    LEFT JOIN performance_schema.events_waits_current w ON w.THREAD_ID=t.THREAD_ID AND w.END_EVENT_ID IS NULL
      AND w.OBJECT_TYPE='TABLE' AND w.OBJECT_SCHEMA=DATABASE()
    WHERE t.TYPE='FOREGROUND' AND t.PROCESSLIST_DB=DATABASE() AND t.PROCESSLIST_ID<>CONNECTION_ID()
    ORDER BY t.PROCESSLIST_COMMAND='Sleep', t.PROCESSLIST_TIME DESC, t.PROCESSLIST_ID LIMIT 50";
const BASIC_SESSIONS: &str = "SELECT CAST(ID AS CHAR), CAST(NULL AS CHAR), HOST, COMMAND,
    COALESCE(NULLIF(STATE,''),COMMAND), CAST(NULL AS CHAR),
    CASE WHEN COMMAND <> 'Sleep' THEN CAST(TIME AS UNSIGNED)*1000 END
    FROM information_schema.PROCESSLIST WHERE DB=DATABASE() AND ID<>CONNECTION_ID()
    ORDER BY COMMAND='Sleep', TIME DESC, ID LIMIT 50";
const TABLE_USAGE: &str = "SELECT OBJECT_NAME, CAST(COUNT_STAR AS UNSIGNED)
    FROM performance_schema.table_io_waits_summary_by_table
    WHERE OBJECT_SCHEMA=DATABASE() AND OBJECT_TYPE='TABLE' AND COUNT_STAR>0
    ORDER BY COUNT_STAR DESC, OBJECT_NAME LIMIT 20";

type SessionRow = (
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<u64>,
);

// Database-level restrictions or missing Performance Schema tables only affect their section.
// Transport failures must reach the caller so stale snapshots are never reported as fresh.
fn optional<T>(
    result: std::result::Result<T, sqlx::Error>,
    report: &mut DatabaseMonitor,
    reason: &str,
) -> Result<Option<T>> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(sqlx::Error::Database(_)) => {
            report.notes.push(reason.into());
            Ok(None)
        }
        Err(error) => Err(error.into()),
    }
}

fn metric(report: &mut DatabaseMonitor, label: &str, value: Option<u64>, unit: &str, scope: &str) {
    if let Some(value) = value {
        report.indicators.push(Indicator {
            label: label.into(),
            value,
            unit: unit.into(),
            scope: scope.into(),
        });
    }
}

pub(crate) async fn collect(pool: &MySqlPool) -> Result<DatabaseMonitor> {
    let mut report = DatabaseMonitor {
        memory: Memory {
            label: "Dados no buffer pool InnoDB".into(),
            scope: INSTANCE.into(),
            limit_label: "Buffer pool configurado".into(),
            ..Default::default()
        },
        ..Default::default()
    };
    let settings = sqlx::query_as::<_, (u64,u64,u64)>(
        "SELECT CAST(@@global.innodb_buffer_pool_size AS UNSIGNED), CAST(@@global.innodb_page_size AS UNSIGNED),
         CAST(@@global.performance_schema AS UNSIGNED)").fetch_one(pool).await;
    let settings = optional(
        settings,
        &mut report,
        "O servidor não disponibilizou as configurações de InnoDB e Performance Schema.",
    )?;
    let page_size = settings.map(|(_, page, _)| page);
    report.memory.limit_bytes = settings.map(|(cap, _, _)| cap);
    let stats = sqlx::query_as::<_, (String,String)>("SHOW GLOBAL STATUS WHERE Variable_name IN
        ('Innodb_buffer_pool_bytes_data','Innodb_buffer_pool_pages_free','Innodb_buffer_pool_wait_free',
         'Innodb_buffer_pool_reads','Innodb_buffer_pool_read_requests','Uptime')").fetch_all(pool).await;
    if let Some(rows) = optional(
        stats,
        &mut report,
        "O servidor não disponibilizou os contadores globais do InnoDB.",
    )? {
        let counters: HashMap<_, _> = rows
            .into_iter()
            .filter_map(|(name, value)| {
                Some((name.to_ascii_lowercase(), value.parse::<u64>().ok()?))
            })
            .collect();
        let counter = |name: &str| counters.get(name).copied();
        report.memory.used_bytes = counter("innodb_buffer_pool_bytes_data");
        metric(
            &mut report,
            "Páginas livres no buffer pool",
            page_size
                .zip(counter("innodb_buffer_pool_pages_free"))
                .and_then(|(page, n)| page.checked_mul(n)),
            "bytes",
            INSTANCE,
        );
        metric(
            &mut report,
            "Esperas por páginas livres",
            counter("innodb_buffer_pool_wait_free"),
            "count",
            "InnoDB · contador acumulado",
        );
        metric(
            &mut report,
            "Leituras físicas do buffer pool",
            counter("innodb_buffer_pool_reads"),
            "count",
            "InnoDB · contador acumulado",
        );
        metric(
            &mut report,
            "Pedidos de leitura lógica",
            counter("innodb_buffer_pool_read_requests"),
            "count",
            "InnoDB · contador acumulado",
        );
        metric(
            &mut report,
            "Tempo desde a inicialização",
            counter("uptime"),
            "seconds",
            INSTANCE,
        );
    }
    let space = sqlx::query_scalar::<_, Option<u64>>("SELECT CASE WHEN COUNT(*)=0 THEN CAST(0 AS UNSIGNED)
        WHEN COUNT(DATA_LENGTH)+COUNT(INDEX_LENGTH)=2*COUNT(*) THEN CAST(SUM(DATA_LENGTH+INDEX_LENGTH) AS UNSIGNED) END
        FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'").fetch_one(pool).await;
    if let Some(bytes) = optional(
        space,
        &mut report,
        "Espaço de dados e índices indisponível neste banco.",
    )? {
        metric(
            &mut report,
            "Dados e índices alocados (estimativa)",
            bytes,
            "bytes",
            DATABASE,
        );
    }
    let mut sessions = None;
    if settings.is_some_and(|(_, _, enabled)| enabled != 0) {
        sessions = optional(sqlx::query_as::<_, SessionRow>(SESSIONS).fetch_all(pool).await, &mut report,
            "Detalhes de instrução, aplicação e tabela do Performance Schema indisponíveis para esta conta ou versão.")?;
        if let Some(tables) = optional(
            sqlx::query_as::<_, (String, u64)>(TABLE_USAGE)
                .fetch_all(pool)
                .await,
            &mut report,
            "Contadores de operações por tabela indisponíveis para esta conta.",
        )? {
            for (name, value) in tables {
                report.objects.push(ObjectActivity {
                    usage: None,
                    name,
                    value,
                    metric: "Operações de tabela".into(),
                    unit: "count".into(),
                    window:
                        "Desde o início ou reinicialização dos contadores do Performance Schema"
                            .into(),
                });
            }
        }
    } else {
        report.notes.push("Performance Schema indisponível. Identidade da aplicação, tabelas em uso e contadores por tabela dependem da instrumentação do servidor.".into());
    }
    if sessions.is_none() {
        sessions = optional(
            sqlx::query_as::<_, SessionRow>(BASIC_SESSIONS)
                .fetch_all(pool)
                .await,
            &mut report,
            "A conta não conseguiu listar as sessões do banco.",
        )?;
        report.notes.push("A lista básica pode mostrar apenas as sessões do próprio usuário. O privilégio PROCESS amplia a visibilidade.".into());
    }
    if let Some(rows) = sessions {
        report.activity = rows
            .into_iter()
            .map(
                |(id, application, client, operation, state, object, elapsed_ms)| Activity {
                    database: None,
                    last_request_end: None,
                    id,
                    application,
                    client,
                    operation,
                    state,
                    object,
                    elapsed_ms,
                },
            )
            .collect();
    }
    report.notes.push("A memória exibida corresponde aos dados na cache InnoDB da instância. Conexões e outras alocações do mysqld consomem memória adicional.".into());
    report.notes.push("As sessões usam este banco como padrão. O tempo indica a duração do estado atual. A aplicação é o nome do programa ou do driver informado pelo cliente. A tabela aparece quando há uma espera de tabela instrumentada na amostra.".into());
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "requer a fixture local isolada de monitoramento MySQL"]
    async fn reads_mysql_monitor_fixture() {
        let url = std::env::var("JUJUBA_MYSQL_MONITOR_FIXTURE_URL").unwrap();
        let pool = MySqlPool::connect(&url).await.unwrap();
        let report = collect(&pool).await.unwrap();
        assert!(report.memory.used_bytes.is_some_and(|value| value > 0));
        assert_eq!(report.memory.limit_bytes, Some(32 * 1024 * 1024));
        assert!(report
            .indicators
            .iter()
            .any(|value| value.label.contains("índices") && value.value > 0));
        assert!(report
            .objects
            .iter()
            .any(|row| row.name == "jujuba_fixture" && row.value > 0));
        assert!(!report
            .notes
            .iter()
            .any(|s| s.starts_with("Detalhes de instrução")));
        pool.close().await;
    }
}
