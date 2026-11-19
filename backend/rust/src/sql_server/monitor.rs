use super::{connection::SqlClient, optional_text, text, unexpected_catalog, Row};
use crate::{
    db_monitor::{Activity, DatabaseMonitor, Indicator, Memory, ObjectActivity},
    error::Result,
};

const INSTANCE: &str = "Instância SQL Server";
const DATABASE: &str = "Banco selecionado";

// String projections work with both TDS (network) and ODBC (local).
fn numeric(row: &Row, name: &str) -> Result<Option<u64>> {
    optional_text(row, name)?
        .map(|value| value.parse().map_err(|_| unexpected_catalog()))
        .transpose()
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

async fn section(
    client: &mut SqlClient,
    report: &mut DatabaseMonitor,
    sql: &str,
    unavailable: &str,
) -> Result<Vec<Row>> {
    match client.query(sql, &[]).await {
        Ok(rows) => Ok(rows),
        Err(error) if matches!(error.kind, "network" | "authentication" | "timeout") => Err(error),
        Err(_) => {
            report.notes.push(unavailable.into());
            Ok(Vec::new())
        }
    }
}

const SESSIONS: &str = include_str!("monitor/sessions.sql");

const TABLE_LOCKS: &str = include_str!("monitor/table_locks.sql");

const TABLE_USAGE: &str = include_str!("monitor/table_usage.sql");

pub(crate) async fn collect(client: &mut SqlClient) -> Result<DatabaseMonitor> {
    client.set_dashboard_lock_timeout().await?;
    let mut report = DatabaseMonitor {
        memory: Memory {
            label: "Memória comprometida pelo gerenciador SQL".into(),
            scope: INSTANCE.into(),
            limit_label: "Máximo configurado (max server memory)".into(),
            ..Default::default()
        },
        ..Default::default()
    };
    let config = section(
        client,
        &mut report,
        include_str!("monitor/config.sql"),
        "A configuração max server memory não está visível para esta conexão.",
    )
    .await?;
    if let Some(row) = config.first() {
        if let Some(cap) = numeric(row, "cap_mib")? {
            if cap == 2_147_483_647 {
                report.memory.limit_label = "Limite padrão, sem teto prático definido".into();
                report.notes.push("A instância usa o valor padrão de max server memory, sem um teto prático explícito.".into());
            } else {
                report.memory.limit_bytes = cap.checked_mul(1_048_576);
            }
        }
    }
    let files = section(
        client,
        &mut report,
        include_str!("monitor/files.sql"),
        "Os arquivos de dados deste banco não estão visíveis para esta conexão.",
    )
    .await?;
    if let Some(row) = files.first() {
        metric(
            &mut report,
            "Arquivos de dados alocados",
            numeric(row, "allocated")?,
            "bytes",
            DATABASE,
        );
        metric(
            &mut report,
            "Livre dentro dos arquivos de dados",
            numeric(row, "free_space")?,
            "bytes",
            DATABASE,
        );
    }
    let caps = section(
        client,
        &mut report,
        include_str!("monitor/caps.sql"),
        "O SQL Server não confirmou a visibilidade de sessões de outros clientes.",
    )
    .await?;
    if !caps
        .first()
        .is_some_and(|row| matches!(numeric(row, "visible"), Ok(Some(1))))
    {
        report.notes.push("A conta pode ver apenas as próprias sessões. A visibilidade da instância depende de VIEW SERVER STATE ou, no SQL Server 2022 e posteriores, VIEW SERVER PERFORMANCE STATE.".into());
    }
    let memory = section(
        client,
        &mut report,
        include_str!("monitor/memory.sql"),
        "Memória comprometida e meta indisponíveis nesta versão ou com as permissões atuais.",
    )
    .await?;
    if let Some(row) = memory.first() {
        report.memory.used_bytes = numeric(row, "committed")?;
        metric(
            &mut report,
            "Meta dinâmica do gerenciador SQL",
            numeric(row, "target")?,
            "bytes",
            INSTANCE,
        );
    }
    let process = section(
        client,
        &mut report,
        include_str!("monitor/process.sql"),
        "A memória física do processo SQL não está disponível.",
    )
    .await?;
    if let Some(row) = process.first() {
        metric(
            &mut report,
            "Memória física usada pelo processo SQL",
            numeric(row, "resident")?,
            "bytes",
            INSTANCE,
        );
    }
    let grants = section(
        client,
        &mut report,
        include_str!("monitor/grants.sql"),
        "A fila de concessão de memória não está disponível.",
    )
    .await?;
    if let Some(row) = grants.first() {
        metric(
            &mut report,
            "Consultas aguardando memória",
            numeric(row, "waiting")?,
            "count",
            INSTANCE,
        );
    }
    let host = section(
        client,
        &mut report,
        include_str!("monitor/host.sql"),
        "O servidor não informou a memória disponível do sistema operacional.",
    )
    .await?;
    if let Some(row) = host.first() {
        metric(
            &mut report,
            "RAM disponível no sistema operacional",
            numeric(row, "available")?,
            "bytes",
            "Host do SQL Server",
        );
    }
    let io = section(
        client,
        &mut report,
        include_str!("monitor/file_io.sql"),
        "Os contadores de E/S dos arquivos deste banco não estão disponíveis.",
    )
    .await?;
    if let Some(row) = io.first() {
        let window = "Arquivos do banco · contador acumulado";
        metric(
            &mut report,
            "Leitura nos arquivos",
            numeric(row, "bytes_read")?,
            "bytes",
            window,
        );
        metric(
            &mut report,
            "Gravação nos arquivos",
            numeric(row, "bytes_written")?,
            "bytes",
            window,
        );
    }
    let sessions = section(
        client,
        &mut report,
        SESSIONS,
        "Não foi possível listar as sessões deste banco.",
    )
    .await?;
    for row in sessions {
        report.activity.push(Activity {
            id: text(&row, "sid")?,
            application: optional_text(&row, "program_name")?.filter(|v| !v.is_empty()),
            client: optional_text(&row, "host_name")?.filter(|v| !v.is_empty()),
            operation: optional_text(&row, "command")?,
            state: optional_text(&row, "state")?,
            elapsed_ms: numeric(&row, "elapsed_ms")?,
            object: None,
        });
    }
    if report.activity.iter().any(|row| row.operation.is_some()) {
        let locks = section(
            client,
            &mut report,
            TABLE_LOCKS,
            "As tabelas com travas de objeto não estão visíveis.",
        )
        .await?;
        for row in locks {
            let id = super::int(&row, "sid")?.to_string();
            let object = optional_text(&row, "table_name")?;
            for activity in report
                .activity
                .iter_mut()
                .filter(|a| a.id == id && a.operation.is_some())
            {
                activity.object.clone_from(&object);
            }
        }
        report.notes.push("Uma tabela na sessão indica uma trava de objeto observada na transação. A sessão pode acessar outras tabelas.".into());
    }
    for row in section(
        client,
        &mut report,
        TABLE_USAGE,
        "Os contadores de acesso aos índices não estão disponíveis.",
    )
    .await?
    {
        if let Some(value) = numeric(&row, "hits")? {
            report.objects.push(ObjectActivity {
                name: text(&row, "table_name")?,
                metric: "Acessos aos índices".into(),
                value,
                unit: "count".into(),
                window: "Desde o início ou reinicialização das estatísticas do índice".into(),
            });
        }
    }
    Ok(report)
}
