use crate::db_monitor::{Activity, DatabaseMonitor, Indicator, Memory, ObjectActivity};
use crate::error::Result;
use sqlx::{PgPool, Row, SqlitePool};

fn metric(label: &str, value: u64, unit: &str, scope: &str) -> Indicator {
    Indicator {
        label: label.into(),
        value,
        unit: unit.into(),
        scope: scope.into(),
    }
}

pub(crate) async fn postgres(pool: &PgPool) -> Result<DatabaseMonitor> {
    let mut conn = pool.acquire().await?;
    let (capacity, work_mem): (i64, i64) = sqlx::query_as(
        "SELECT pg_catalog.pg_size_bytes(pg_catalog.current_setting('shared_buffers')),
                pg_catalog.pg_size_bytes(pg_catalog.current_setting('work_mem'))",
    )
    .fetch_one(&mut *conn)
    .await?;
    let mut report = DatabaseMonitor {
        memory: Memory {
            label: "Cache compartilhado ocupado".into(),
            scope: "Instância PostgreSQL".into(),
            limit_bytes: u64::try_from(capacity).ok(),
            limit_label: "Capacidade de shared_buffers".into(),
            ..Default::default()
        },
        ..Default::default()
    };
    report.notes.push("O cache é compartilhado entre os bancos. A RAM total também inclui processos e alocações de cada operação.".into());
    report.indicators.push(metric(
        "work_mem por operação",
        work_mem as u64,
        "bytes",
        "Configuração da sessão",
    ));

    // Resolve the function by extension ownership instead of trusting the database search path.
    let summary = sqlx::query_scalar::<_, String>(
        "SELECT pg_catalog.format('%I.%I', n.nspname, p.proname)
         FROM pg_catalog.pg_extension e
         JOIN pg_catalog.pg_depend d ON d.refclassid = 'pg_catalog.pg_extension'::regclass AND d.refobjid = e.oid AND d.deptype = 'e'
         JOIN pg_catalog.pg_proc p ON d.classid = 'pg_catalog.pg_proc'::regclass AND p.oid = d.objid
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE e.extname = 'pg_buffercache' AND p.proname = 'pg_buffercache_summary' AND p.pronargs = 0
           AND pg_catalog.has_schema_privilege(n.oid, 'USAGE') AND pg_catalog.has_function_privilege(p.oid, 'EXECUTE')",
    ).fetch_optional(&mut *conn).await;
    if let Ok(Some(function)) = summary {
        report.memory.used_bytes = sqlx::query_scalar::<_, i64>(&format!(
            "SELECT buffers_used::bigint * pg_catalog.current_setting('block_size')::bigint FROM {function}()"
        )).fetch_one(&mut *conn).await.ok().and_then(|n| n.try_into().ok());
    }
    if report.memory.used_bytes.is_none() {
        report.notes.push("A ocupação do cache requer acesso a pg_buffercache_summary() nessa versão da extensão pg_buffercache.".into());
    }

    if let Ok(stats) = sqlx::query(
        "SELECT numbackends, temp_bytes, blks_read, blks_hit FROM pg_catalog.pg_stat_database WHERE datname = current_database()"
    ).fetch_one(&mut *conn).await {
        for (column, label, unit) in [
            ("temp_bytes", "Gravações temporárias acumuladas", "bytes"),
            ("blks_read", "Blocos lidos acumulados", "count"),
            ("blks_hit", "Acertos no cache acumulados", "count"),
        ] {
            if let Ok(value) = stats.try_get::<i64, _>(column) {
                report.indicators.push(metric(label, value as u64, unit, "Banco · desde a zeragem das estatísticas"));
            }
        }
    }
    const ACTIVITY: &str = r"
        WITH sessions AS (
            SELECT pid, NULLIF(application_name, '') AS app, host(client_addr) AS client,
                   state, wait_event_type, wait_event, query_start,
                   CASE WHEN state = 'active' THEN upper(substring(ltrim(query) FROM
                     '(?i)^(select|update|insert|delete|merge|with|call|fetch|copy|vacuum|analyze|commit|rollback|alter|create|drop|set|show|explain|begin|lock|listen|notify|start|values|refresh)\y')) END AS verb
            FROM pg_catalog.pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'
            ORDER BY (state = 'active') DESC NULLS LAST, query_start ASC NULLS LAST, pid LIMIT 51
        ), relations AS (
            SELECT DISTINCT ON (l.pid) l.pid, pg_catalog.format('%I.%I', n.nspname, c.relname) AS object_name
            FROM pg_catalog.pg_locks l JOIN sessions s ON s.pid = l.pid AND s.state = 'active'
            JOIN pg_catalog.pg_class c ON c.oid = l.relation
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE l.database = (SELECT oid FROM pg_catalog.pg_database WHERE datname = current_database())
              AND c.relkind IN ('r','p','m','f') AND n.nspname <> 'information_schema' AND left(n.nspname,3) <> 'pg_'
            ORDER BY l.pid, l.granted, (l.mode <> 'AccessShareLock') DESC, c.oid
        )
        SELECT s.pid::text AS id, app, client, verb, s.state, wait_event_type, wait_event, object_name,
               CASE WHEN s.state = 'active' THEN greatest(0, extract(epoch FROM (clock_timestamp()-s.query_start))*1000)::bigint END AS elapsed
        FROM sessions s LEFT JOIN relations l USING (pid)
        ORDER BY (s.state = 'active') DESC NULLS LAST, s.query_start ASC NULLS LAST, s.pid";
    match sqlx::query(ACTIVITY).fetch_all(&mut *conn).await {
        Ok(rows) => {
            if rows.len() > 50 {
                report.notes.push(
                    "Exibindo até 50 sessões do banco, com prioridade para as ativas.".into(),
                );
            }
            for row in rows.into_iter().take(50) {
                let state: Option<String> = row.try_get("state")?;
                let status = match state.as_deref() {
                    Some("active") => {
                        let wait: Option<String> = row.try_get("wait_event")?;
                        wait.map_or_else(
                            || "Em execução".into(),
                            |event| format!("Aguardando · {event}"),
                        )
                    }
                    Some("idle") => "Ociosa".into(),
                    Some("idle in transaction") => "Ociosa em transação".into(),
                    Some(other) => other.into(),
                    None => "Visibilidade restrita".into(),
                };
                report.activity.push(Activity {
                    id: row.try_get("id")?,
                    application: row.try_get("app")?,
                    client: row.try_get("client")?,
                    operation: row.try_get("verb")?,
                    state: Some(status),
                    object: row.try_get("object_name")?,
                    elapsed_ms: row
                        .try_get::<Option<i64>, _>("elapsed")?
                        .and_then(|v| v.try_into().ok()),
                });
            }
            report.notes.push("Cada sessão pode usar várias tabelas. A atividade mostra uma relação com bloqueio observado na transação; detalhes de outras sessões dependem das permissões.".into());
        }
        Err(_) => report
            .notes
            .push("As sessões do banco estão indisponíveis nesta conexão.".into()),
    }
    let tables = sqlx::query_as::<_, (String, i64)>(
        "SELECT pg_catalog.format('%I.%I', schemaname, relname), (seq_scan + coalesce(idx_scan, 0))::bigint AS scans
         FROM pg_catalog.pg_stat_user_tables
         WHERE (seq_scan + coalesce(idx_scan, 0)) > 0 AND pg_catalog.has_schema_privilege(schemaname, 'USAGE')
           AND (pg_catalog.has_table_privilege(relid, 'SELECT') OR pg_catalog.has_any_column_privilege(relid, 'SELECT'))
         ORDER BY scans DESC, schemaname, relname LIMIT 20",
    ).fetch_all(&mut *conn).await;
    match tables {
        Ok(rows) => {
            report.objects = rows
                .into_iter()
                .map(|(name, count)| ObjectActivity {
                    name,
                    metric: "Varreduras sequenciais e por índice".into(),
                    value: count as u64,
                    unit: "count".into(),
                    window: "Acumulado desde a zeragem das estatísticas da tabela".into(),
                })
                .collect()
        }
        Err(_) => report
            .notes
            .push("As estatísticas por tabela estão indisponíveis nesta conexão.".into()),
    }
    Ok(report)
}

pub(crate) async fn sqlite(pool: &SqlitePool) -> Result<DatabaseMonitor> {
    let mut conn = pool.acquire().await?;
    let (pages, page_bytes, free, soft_cache): (i64, i64, i64, i64) = sqlx::query_as(
        "SELECT page_count, page_size, freelist_count, cache_size
         FROM pragma_page_count(), pragma_page_size(), pragma_freelist_count(), pragma_cache_size()",
    ).fetch_one(&mut *conn).await?;
    let cached = {
        let mut handle = conn.lock_handle().await?;
        let (mut bytes, mut unused_peak) = (0, 0);
        // SQLx holds its SQLite worker lock for the duration of this synchronous read.
        let rc = unsafe {
            libsqlite3_sys::sqlite3_db_status(
                handle.as_raw_handle().as_ptr(),
                libsqlite3_sys::SQLITE_DBSTATUS_CACHE_USED,
                &mut bytes,
                &mut unused_peak,
                0,
            )
        };
        (rc == libsqlite3_sys::SQLITE_OK)
            .then(|| u64::try_from(bytes).ok())
            .flatten()
    };
    let page_bytes = page_bytes as u64;
    let suggested = if soft_cache < 0 {
        soft_cache.unsigned_abs().saturating_mul(1024)
    } else {
        (soft_cache as u64).saturating_mul(page_bytes)
    };
    let mut report = DatabaseMonitor {
        memory: Memory { label: "Cache de páginas em uso".into(), scope: "Conexão do JUJUBA · SQLite".into(), used_bytes: cached, ..Default::default() },
        indicators: vec![
            metric("Cache sugerido", suggested, "bytes", "Conexão do JUJUBA"),
            metric("Tamanho em páginas", (pages as u64).saturating_mul(page_bytes), "bytes", "Arquivo principal"),
            metric("Espaço reutilizável", (free as u64).saturating_mul(page_bytes), "bytes", "Páginas livres no arquivo"),
        ],
        notes: vec!["O SQLite roda dentro de cada aplicativo. A leitura mede o cache da conexão consultada do JUJUBA. O arquivo não expõe as sessões nem as tabelas em uso por outros aplicativos.".into()],
        ..Default::default()
    };
    if cached.is_none() {
        report
            .notes
            .push("O SQLite não informou a memória do cache desta conexão.".into());
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn sqlite_reports_its_own_cache_and_file_pages() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE example (id INTEGER)")
            .execute(&pool)
            .await
            .unwrap();
        let report = sqlite(&pool).await.unwrap();
        assert!(report.memory.used_bytes.unwrap() > 0);
        assert!(report.memory.limit_bytes.is_none());
        assert!(report
            .indicators
            .iter()
            .any(|i| i.label == "Tamanho em páginas" && i.value > 0));
        assert!(report.activity.is_empty());
    }

    #[tokio::test]
    #[ignore = "requer instância PostgreSQL de QA com pg_buffercache e usuário jujuqa"]
    async fn postgres_distinguishes_active_connection_and_shared_cache() {
        let port: u16 = std::env::var("JUJUBA_TEST_MONITOR_PG_PORT")
            .unwrap()
            .parse()
            .unwrap();
        let options = sqlx::postgres::PgConnectOptions::new()
            .host("127.0.0.1")
            .port(port)
            .username("jujuqa")
            .database("postgres")
            .application_name("JUJUBA-QA");
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(2)
            .connect_with(options)
            .await
            .unwrap();
        let mut worker = pool.acquire().await.unwrap();
        let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *worker)
            .await
            .unwrap();
        let background = tokio::spawn(async move {
            sqlx::query("SELECT pg_sleep(2)")
                .execute(&mut *worker)
                .await
                .unwrap();
        });
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        let report = postgres(&pool).await.unwrap();
        let session = report
            .activity
            .iter()
            .find(|v| v.id == pid.to_string())
            .unwrap();
        assert_eq!(session.application.as_deref(), Some("JUJUBA-QA"));
        assert_eq!(session.operation.as_deref(), Some("SELECT"));
        assert!(session.elapsed_ms.unwrap() > 0);
        assert!(report.memory.used_bytes.unwrap() > 0);
        assert!(report.memory.limit_bytes.unwrap() >= report.memory.used_bytes.unwrap());
        background.await.unwrap();
    }
}
