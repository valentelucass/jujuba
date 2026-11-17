use crate::{
    error::{AppError, Result},
    no_sql::NoSqlSession,
    other_db::Client,
};
use mongodb::bson::{doc, Bson, Document};
use serde::Serialize;

#[derive(Default, Serialize)]
pub struct EngineDashboard {
    metrics: Vec<Metric>,
    tables: Vec<TableSize>,
    partial: bool,
}

#[derive(Serialize)]
struct Metric {
    label: &'static str,
    value: u64,
    unit: Unit,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
enum Unit {
    Count,
    Bytes,
    PerSecond,
}

#[derive(Serialize)]
struct TableSize {
    name: String,
    bytes: u64,
}

impl EngineDashboard {
    fn add(&mut self, label: &'static str, value: u64, unit: Unit) {
        self.metrics.push(Metric { label, value, unit });
    }
}

pub async fn sql(client: Client) -> Result<EngineDashboard> {
    let mut report = EngineDashboard::default();
    match client {
        Client::Mysql(pool) => {
            let (tables, views, data, indexes) = sqlx::query_as::<_, (u64, u64, u64, u64)>(
                "SELECT CAST(COUNT(CASE WHEN TABLE_TYPE = 'BASE TABLE' THEN 1 END) AS UNSIGNED),
                        CAST(COUNT(CASE WHEN TABLE_TYPE = 'VIEW' THEN 1 END) AS UNSIGNED),
                        CAST(COALESCE(SUM(DATA_LENGTH), 0) AS UNSIGNED),
                        CAST(COALESCE(SUM(INDEX_LENGTH), 0) AS UNSIGNED)
                 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()",
            )
            .fetch_one(&pool)
            .await?;
            report.add("Tabelas visíveis", tables, Unit::Count);
            report.add("Views visíveis", views, Unit::Count);
            report.add("Dados alocados", data, Unit::Bytes);
            report.add("Índices alocados", indexes, Unit::Bytes);
            report.tables = sqlx::query_as::<_, (String, u64)>(
                "SELECT TABLE_NAME, CAST(COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0) AS UNSIGNED) AS bytes
                 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
                 ORDER BY bytes DESC, TABLE_NAME LIMIT 12",
            ).fetch_all(&pool).await?.into_iter().map(|(name, bytes)| TableSize { name, bytes }).collect();
        }
        Client::Postgres(pool) => {
            // Apply the same visibility rules used by the object explorer.
            const VISIBLE: &str =
                "FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                 WHERE left(n.nspname, 3) <> 'pg_' AND n.nspname <> 'information_schema'
                   AND has_schema_privilege(n.oid, 'USAGE')
                   AND (has_table_privilege(c.oid, 'SELECT') OR has_any_column_privilege(c.oid, 'SELECT'))";
            let summary = format!(
                "SELECT COUNT(*) FILTER (WHERE c.relkind IN ('r','p','f')),
                        COUNT(*) FILTER (WHERE c.relkind IN ('v','m')),
                        COUNT(DISTINCT n.nspname),
                        COALESCE(SUM(CASE WHEN c.relkind IN ('r','m') THEN pg_catalog.pg_total_relation_size(c.oid) ELSE 0 END),0)::bigint
                 {VISIBLE} AND c.relkind IN ('r','p','f','v','m')",
            );
            let (tables, views, schemas, bytes) =
                sqlx::query_as::<_, (i64, i64, i64, i64)>(&summary)
                    .fetch_one(&pool)
                    .await?;
            report.add("Tabelas visíveis", tables as u64, Unit::Count);
            report.add("Views visíveis", views as u64, Unit::Count);
            report.add("Esquemas visíveis", schemas as u64, Unit::Count);
            report.add("Espaço das relações visíveis", bytes as u64, Unit::Bytes);
            let largest = format!(
                "SELECT n.nspname::text, c.relname::text, pg_catalog.pg_total_relation_size(c.oid) AS bytes
                 {VISIBLE} AND c.relkind IN ('r','m') ORDER BY bytes DESC, n.nspname, c.relname LIMIT 12",
            );
            report.tables = sqlx::query_as::<_, (String, String, i64)>(&largest)
                .fetch_all(&pool)
                .await?
                .into_iter()
                .map(|(schema, name, bytes)| TableSize {
                    name: format!("{schema}.{name}"),
                    bytes: bytes as u64,
                })
                .collect();
        }
        Client::Sqlite(pool) => {
            let (tables, views, indexes) = sqlx::query_as::<_, (i64, i64, i64)>(
                "SELECT COUNT(CASE WHEN type = 'table' THEN 1 END),
                        COUNT(CASE WHEN type = 'view' THEN 1 END),
                        COUNT(CASE WHEN type = 'index' THEN 1 END)
                 FROM main.sqlite_schema WHERE name NOT GLOB 'sqlite_*'",
            )
            .fetch_one(&pool)
            .await?;
            let (pages, size, free) = sqlx::query_as::<_, (i64, i64, i64)>(
                "SELECT page_count, page_size, freelist_count
                 FROM pragma_page_count(), pragma_page_size(), pragma_freelist_count()",
            )
            .fetch_one(&pool)
            .await?;
            report.add("Tabelas", tables as u64, Unit::Count);
            report.add("Views", views as u64, Unit::Count);
            report.add("Índices explícitos", indexes as u64, Unit::Count);
            report.add(
                "Espaço em páginas",
                (pages as u64).saturating_mul(size as u64),
                Unit::Bytes,
            );
            report.add(
                "Espaço livre no arquivo",
                (free as u64).saturating_mul(size as u64),
                Unit::Bytes,
            );
        }
    }
    Ok(report)
}

pub async fn no_sql(session: &NoSqlSession, database: &str) -> Result<EngineDashboard> {
    let mut report = EngineDashboard::default();
    match session {
        NoSqlSession::Mongo(client) => {
            match client
                .database(database)
                .run_command(doc! { "dbStats": 1, "scale": 1 })
                .await
            {
                Ok(stats) => {
                    for (key, label, unit) in [
                        ("collections", "Coleções", Unit::Count),
                        ("objects", "Documentos", Unit::Count),
                        ("dataSize", "Dados sem compressão", Unit::Bytes),
                        ("storageSize", "Armazenamento alocado", Unit::Bytes),
                        ("indexSize", "Índices alocados", Unit::Bytes),
                    ] {
                        if let Some(value) = bson_number(&stats, key) {
                            report.add(label, value, unit);
                        }
                    }
                }
                Err(_) => {
                    let collections = session.collections(database).await?;
                    report.add("Coleções visíveis", collections.len() as u64, Unit::Count);
                    report.partial = true;
                }
            }
        }
        NoSqlSession::Redis(manager) => {
            let mut manager = manager.clone();
            let keys = redis::cmd("DBSIZE").query_async::<u64>(&mut manager).await.map_err(|_| {
                AppError::new("query", "O Redis não retornou a contagem de chaves. Confira a permissão do comando DBSIZE.")
            })?;
            report.add("Chaves no banco selecionado", keys, Unit::Count);
            if let Ok(info) = redis::cmd("INFO").query_async::<String>(&mut manager).await {
                for (key, label, unit) in [
                    ("used_memory", "Memória usada no servidor", Unit::Bytes),
                    ("connected_clients", "Clientes no servidor", Unit::Count),
                    (
                        "instantaneous_ops_per_sec",
                        "Operações por segundo no servidor",
                        Unit::PerSecond,
                    ),
                ] {
                    if let Some(value) = info
                        .lines()
                        .filter_map(|line| line.split_once(':'))
                        .find(|(name, _)| *name == key)
                        .and_then(|(_, value)| value.trim().parse().ok())
                    {
                        report.add(label, value, unit);
                    }
                }
            } else {
                report.partial = true;
            }
        }
    }
    Ok(report)
}

fn bson_number(stats: &Document, key: &str) -> Option<u64> {
    match stats.get(key)? {
        Bson::Int32(value) => u64::try_from(*value).ok(),
        Bson::Int64(value) => u64::try_from(*value).ok(),
        Bson::Double(value) if value.is_finite() && *value >= 0.0 => Some(*value as u64),
        _ => None,
    }
}
