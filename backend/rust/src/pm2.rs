use crate::error::{AppError, Result};
use crate::{
    pm2_host::{self, HostMetrics},
    pm2_ports,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};
use zeroize::Zeroizing;

#[path = "pm2_protection.rs"]
mod protection;
pub(crate) use protection::optimizer_protection;

const MAX_LIST: u64 = 16 * 1024 * 1024;
static ACTIONS: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    sampled_at: u64,
    processes: Vec<Process>,
    #[serde(skip_serializing_if = "Option::is_none")]
    host: Option<HostMetrics>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostSnapshot {
    sampled_at: u64,
    host: HostMetrics,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Process {
    id: u32,
    name: String,
    namespace: String,
    status: String,
    pid: Option<u32>,
    mode: String,
    cpu: Option<f64>,
    memory_bytes: Option<u64>,
    started_at: Option<u64>,
    restarts: Option<u64>,
    watching: bool,
    cwd: Option<PathBuf>,
    script: Option<PathBuf>,
    version: Option<String>,
    ports: Option<Vec<u16>>,
}

#[derive(Deserialize)]
struct Entry {
    pm_id: u32,
    name: String,
    pid: Option<u32>,
    pm2_env: Pm2Env,
    monit: Option<Monitor>,
}

#[derive(Deserialize)]
struct Pm2Env {
    status: String,
    namespace: Option<String>,
    exec_mode: Option<String>,
    pm_uptime: Option<u64>,
    restart_time: Option<u64>,
    watch: Option<serde_json::Value>,
    pm_cwd: Option<PathBuf>,
    pm_exec_path: Option<PathBuf>,
    version: Option<String>,
}

#[derive(Deserialize)]
struct Monitor {
    cpu: Option<f64>,
    memory: Option<u64>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Action {
    Start,
    Stop,
    Restart,
    Reload,
    Delete,
}

impl Action {
    fn argument(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Stop => "stop",
            Self::Restart => "restart",
            Self::Reload => "reload",
            Self::Delete => "delete",
        }
    }
}

fn parse_list(output: &[u8]) -> Result<Vec<Process>> {
    let malformed = || {
        AppError::new(
            "pm2_json",
            "O PM2 não devolveu uma lista de processos válida.",
        )
    };
    // The CLI may prefix its one-line JSON document with a version notice. Such notices can
    // contain bracketed labels. Only accept the final line as a complete, typed JSON array.
    let json = std::str::from_utf8(output)
        .map_err(|_| malformed())?
        .trim_end()
        .rsplit('\n')
        .next()
        .unwrap_or("")
        .trim()
        .trim_start_matches('\u{feff}');
    let entries: Vec<Entry> = serde_json::from_str(json).map_err(|_| malformed())?;
    Ok(entries
        .into_iter()
        .map(|entry| {
            let info = entry.pm2_env;
            let watching = match info.watch {
                Some(serde_json::Value::Bool(value)) => value,
                Some(serde_json::Value::String(path)) => !path.is_empty(),
                Some(serde_json::Value::Array(paths)) => !paths.is_empty(),
                _ => false,
            };
            let pid = entry.pid.filter(|pid| *pid > 0);
            Process {
                id: entry.pm_id,
                name: entry.name,
                namespace: info.namespace.unwrap_or_else(|| "default".into()),
                status: info.status,
                pid,
                mode: info.exec_mode.unwrap_or_default(),
                cpu: entry
                    .monit
                    .as_ref()
                    .and_then(|m| m.cpu)
                    .filter(|cpu| cpu.is_finite() && *cpu >= 0.),
                memory_bytes: entry.monit.and_then(|m| m.memory),
                started_at: info.pm_uptime.filter(|start| *start > 0 && pid.is_some()),
                restarts: info.restart_time,
                watching,
                cwd: info.pm_cwd,
                script: info.pm_exec_path,
                version: info.version.filter(|v| !v.is_empty() && v != "N/A"),
                ports: None,
            }
        })
        .collect())
}

fn powershell() -> Result<PathBuf> {
    let path = std::env::var_os("PATH").unwrap_or_default();
    let candidates = std::env::split_paths(&path)
        .filter(|dir| dir.is_absolute())
        .map(|dir| dir.join("pwsh.exe"));
    let desktop = std::env::var_os("SystemRoot")
        .map(|dir| PathBuf::from(dir).join("System32/WindowsPowerShell/v1.0/powershell.exe"));
    candidates
        .chain(desktop)
        .find(|shell| shell.is_file())
        .ok_or_else(|| {
            AppError::new(
                "powershell",
                "O PowerShell não foi encontrado neste Windows.",
            )
        })
}

async fn stop_client(child: &mut Child, may_start_daemon: bool) {
    #[cfg(windows)]
    if let (Some(pid), Some(root)) = (child.id(), std::env::var_os("SystemRoot")) {
        let killer = PathBuf::from(root).join("System32/taskkill.exe");
        let mut terminate = Command::new(killer);
        if may_start_daemon {
            // A started daemon and its managed apps can now descend from this client.
            // End only the launcher and its CLI, never the CLI's children.
            for helper in pm2_ports::cli_children(pid) {
                terminate.arg("/PID").arg(helper.to_string());
            }
        } else {
            terminate.arg("/T");
        }
        let _ = tokio::time::timeout(
            Duration::from_secs(3),
            terminate
                .args(["/F", "/PID", &pid.to_string()])
                .creation_flags(0x0800_0000)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .kill_on_drop(true)
                .status(),
        )
        .await;
    }
    let _ = child.kill().await;
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum StateAction {
    Save,
    Resurrect,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ShellView {
    Shell,
    Logs,
    Describe,
    Monit,
}

#[derive(Clone, Copy)]
enum Operation<'a> {
    List,
    Process(Action, u32),
    Scale(&'a str, u16),
    State(StateAction),
    StartFile(&'a Path),
    Inspect(ShellView, u32),
}

fn encoded_script(script: &str) -> String {
    let bytes: Vec<_> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    STANDARD.encode(bytes)
}

fn shell_command(operation: Operation<'_>) -> Result<std::process::Command> {
    let mut command = std::process::Command::new(powershell()?);
    for key in ["ACTION", "ID", "FILE", "NAME", "INSTANCES"] {
        command.env_remove(format!("JUJUBASQL_PM2_{key}"));
    }
    let interactive = matches!(operation, Operation::Inspect(_, _));
    command.arg("-NoLogo");
    if interactive {
        command.arg("-NoExit");
    } else {
        command.args(["-NoProfile", "-NonInteractive"]);
    }
    let verb = match operation {
        Operation::List => "jlist",
        Operation::Process(action, id) => {
            command.env("JUJUBASQL_PM2_ID", id.to_string());
            action.argument()
        }
        Operation::Scale(name, instances) => {
            command
                .env("JUJUBASQL_PM2_NAME", name)
                .env("JUJUBASQL_PM2_INSTANCES", instances.to_string());
            "scale"
        }
        Operation::State(StateAction::Save) => "save",
        Operation::State(StateAction::Resurrect) => "resurrect",
        Operation::StartFile(path) => {
            command.env("JUJUBASQL_PM2_FILE", path);
            if let Some(parent) = path.parent() {
                command.current_dir(parent);
            }
            "start-file"
        }
        Operation::Inspect(view, id) => {
            let verb = match view {
                ShellView::Shell => {
                    command
                        .arg("-EncodedCommand")
                        .arg(encoded_script(include_str!("pm2_dev_shell.ps1")));
                    return Ok(command);
                }
                ShellView::Logs => "logs",
                ShellView::Describe => "describe",
                ShellView::Monit => "monit",
            };
            command.env("JUJUBASQL_PM2_ID", id.to_string());
            verb
        }
    };
    command
        .arg("-EncodedCommand")
        .arg(encoded_script(include_str!("pm2_cli.ps1")))
        .env("JUJUBASQL_PM2_ACTION", verb);
    Ok(command)
}

async fn cli(operation: Operation<'_>) -> Result<Zeroizing<Vec<u8>>> {
    let may_start_daemon = matches!(
        operation,
        Operation::StartFile(_) | Operation::State(StateAction::Resurrect)
    );
    let mut command = Command::from(shell_command(operation)?);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let failed = || {
        AppError::new(
            "pm2",
            "O PM2 não concluiu a operação. Confira a instância do PM2 no PowerShell.",
        )
    };
    let mut child = command.spawn().map_err(|_| failed())?;
    let mut stdout = child.stdout.take().ok_or_else(failed)?.take(MAX_LIST + 1);
    let mut output = Zeroizing::new(Vec::new());
    let limit = if matches!(operation, Operation::List) {
        15
    } else {
        60
    };
    let capture = async {
        let size = stdout
            .read_to_end(&mut output)
            .await
            .map_err(|_| failed())?;
        if size as u64 > MAX_LIST {
            return Err(AppError::new(
                "pm2_size",
                "A lista do PM2 excedeu o tamanho suportado.",
            ));
        }
        child.wait().await.map_err(|_| failed())
    };
    let status = match tokio::time::timeout(Duration::from_secs(limit), capture).await {
        Ok(Ok(status)) => status,
        Ok(Err(error)) => {
            stop_client(&mut child, may_start_daemon).await;
            return Err(error);
        }
        Err(_) => {
            stop_client(&mut child, may_start_daemon).await;
            return Err(AppError::new(
                "timeout",
                "O PM2 demorou a responder. Atualize a lista para conferir o resultado.",
            ));
        }
    };
    match status.code() {
        Some(0) => Ok(output),
        Some(81) => Err(AppError::new("pm2_unavailable", "O PM2 não foi encontrado. Confira se o comando pm2 está disponível no PowerShell.")),
        Some(82) => Err(AppError::new("pm2_daemon", "O PM2 está instalado, mas a instância deste usuário não está em execução. Inicie-a pelo PowerShell e atualize a lista.")),
        Some(84) => Err(AppError::new("pm2_dump","O PM2 não encontrou uma lista salva para restaurar.")),
        Some(85) => Err(AppError::new("pm2_cli","Não foi possível localizar o cliente Node.js do PM2 para passar o caminho ou nome do aplicativo.")),
        _ => Err(failed()),
    }
}

async fn list() -> Result<Vec<Process>> {
    parse_list(&cli(Operation::List).await?)
}

fn selected(processes: Vec<Process>, id: u32, name: &str) -> Result<Process> {
    processes
        .into_iter()
        .find(|p| p.id == id && p.name == name)
        .ok_or_else(|| {
            AppError::new(
                "pm2_changed",
                "O processo mudou ou saiu do PM2. Atualize a lista e selecione-o de novo.",
            )
        })
}

#[tauri::command]
pub(crate) async fn pm2_snapshot(include_host: Option<bool>) -> Result<Snapshot> {
    let mut processes = list().await?;
    let (processes, host) = tauri::async_runtime::spawn_blocking(move || {
        let pids = processes.iter().filter_map(|p| p.pid).collect();
        let ports = pm2_ports::sample(&pids);
        for proc in &mut processes {
            proc.ports = ports.as_ref().map(|table| {
                proc.pid
                    .and_then(|pid| table.get(&pid))
                    .into_iter()
                    .flatten()
                    .copied()
                    .collect()
            });
        }
        (
            processes,
            include_host
                .unwrap_or(true)
                .then(|| pm2_host::sample(false)),
        )
    })
    .await
    .map_err(|_| {
        AppError::new(
            "pm2_host",
            "Não foi possível ler as métricas do computador.",
        )
    })?;
    Ok(Snapshot {
        sampled_at: sample_time(),
        processes,
        host,
    })
}

fn sample_time() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[tauri::command]
pub(crate) async fn host_snapshot(inspect_disk: Option<bool>) -> Result<HostSnapshot> {
    let host = tauri::async_runtime::spawn_blocking(move || {
        pm2_host::sample(inspect_disk.unwrap_or(false))
    })
    .await
    .map_err(|_| {
        AppError::new(
            "host_metrics",
            "Não foi possível ler os recursos do Windows.",
        )
    })?;
    Ok(HostSnapshot {
        sampled_at: sample_time(),
        host,
    })
}

#[tauri::command]
pub(crate) async fn pm2_action(id: u32, name: String, action: Action) -> Result<()> {
    let _guard = ACTIONS.lock().await;
    let process = selected(list().await?, id, &name)?;
    if matches!(action, Action::Start) && !matches!(process.status.as_str(), "stopped" | "errored")
    {
        return Err(AppError::new(
            "pm2_changed",
            "Iniciar se aplica a um processo parado ou com erro. Atualize a lista.",
        ));
    }
    cli(Operation::Process(action, id)).await?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn pm2_open_shell(id: u32, name: String, view: Option<ShellView>) -> Result<()> {
    let process = selected(list().await?, id, &name)?;
    let path = process
        .cwd
        .filter(|path| path.is_absolute() && path.is_dir())
        .ok_or_else(|| {
            AppError::new(
                "pm2_directory",
                "A pasta de trabalho registrada no PM2 não está disponível.",
            )
        })?;
    let view = view.unwrap_or(ShellView::Shell);
    let mut command = shell_command(Operation::Inspect(view, id))?;
    if matches!(view, ShellView::Shell) {
        command.env("JUJUBA_DEV_PROJECT", &path);
    }
    command.current_dir(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0000_0010); // CREATE_NEW_CONSOLE
    }
    command.spawn().map_err(|_| {
        AppError::new(
            "powershell",
            "Não foi possível abrir o PowerShell na pasta do processo.",
        )
    })?;
    Ok(())
}

fn cluster_size(all: &[Process], id: u32, name: &str) -> Result<usize> {
    let anchor = all
        .iter()
        .find(|p| p.id == id && p.name == name)
        .ok_or_else(|| {
            AppError::new(
                "pm2_changed",
                "O processo selecionado mudou. Atualize a lista.",
            )
        })?;
    if anchor.mode != "cluster_mode" {
        return Err(AppError::new(
            "pm2_cluster",
            "Esta operação exige um aplicativo em modo cluster.",
        ));
    }
    // PM2 scale matches the name across namespaces OR a script whose absolute
    // path equals path.resolve(name). Never pass an ambiguous group to the CLI.
    let resolved = std::path::absolute(name).map_err(|_| {
        AppError::new(
            "pm2_cluster",
            "Não foi possível identificar o grupo deste aplicativo.",
        )
    })?;
    let mut size = 0;
    for row in all
        .iter()
        .filter(|row| row.name == name || row.script.as_deref() == Some(resolved.as_path()))
    {
        if row.name != name
            || row.namespace != anchor.namespace
            || row.mode != anchor.mode
            || row.script != anchor.script
            || row.cwd != anchor.cwd
        {
            return Err(AppError::new("pm2_ambiguous","O PM2 encontrou outro aplicativo com o mesmo nome ou caminho. Use nomes únicos para alterar o número de instâncias."));
        }
        size += 1;
    }
    Ok(size)
}

#[tauri::command]
pub(crate) async fn pm2_scale(id: u32, name: String, instances: u16) -> Result<()> {
    if !(1..=256).contains(&instances) {
        return Err(AppError::new(
            "pm2_scale",
            "Escolha entre 1 e 256 instâncias para o cluster.",
        ));
    }
    let _guard = ACTIONS.lock().await;
    let all = list().await?;
    if cluster_size(&all, id, &name)? != usize::from(instances) {
        cli(Operation::Scale(&name, instances)).await?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn pm2_state_action(action: StateAction) -> Result<()> {
    let _guard = ACTIONS.lock().await;
    cli(Operation::State(action)).await?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn pm2_start_file(app: tauri::AppHandle) -> Result<bool> {
    let dialog_error = || {
        AppError::new(
            "pm2_picker",
            "Não foi possível selecionar o arquivo para o PM2.",
        )
    };
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Escolha o script ou arquivo ecosystem para iniciar no PM2")
        .add_filter(
            "Scripts e configurações do PM2",
            &[
                "js", "cjs", "mjs", "ts", "json", "json5", "yaml", "yml", "py", "exe", "cmd",
                "bat", "ps1",
            ],
        )
        .add_filter("Todos os arquivos", &["*"])
        .pick_file(move |path| {
            let _ = send.send(path);
        });
    let Some(file) = receive.await.map_err(|_| dialog_error())? else {
        return Ok(false);
    };
    let path = file.into_path().map_err(|_| dialog_error())?;
    if !path.is_absolute() || !path.is_file() {
        return Err(dialog_error());
    }
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(format!(
            "O PM2 vai executar o arquivo abaixo ou os aplicativos definidos nele.\n\n{}",
            path.display()
        ))
        .title("Iniciar no PM2?")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Iniciar".into(),
            "Cancelar".into(),
        ))
        .show(move |ok| {
            let _ = send.send(ok);
        });
    if !receive.await.map_err(|_| dialog_error())? {
        return Ok(false);
    }
    let _guard = ACTIONS.lock().await;
    cli(Operation::StartFile(&path)).await?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_real_units_and_only_exports_panel_fields() {
        let data = br#"[PM2] Version notice
[{"pm_id":7,"name":"api","pid":1098,"pm2_env":{"status":"online","namespace":"time","exec_mode":"fork_mode","pm_cwd":"private-path","pm_uptime":1700000000123,"restart_time":19,"watch":["src"],"env":{"TOKEN":"private-token"}},"monit":{"cpu":2.5,"memory":4194304}}]"#;
        let rows = parse_list(data).unwrap();
        let row = selected(rows, 7, "api").unwrap();
        assert_eq!(row.cwd.unwrap(), PathBuf::from("private-path"));
        let rows = parse_list(data).unwrap();
        let json = serde_json::to_value(&rows[0]).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"id":7,"name":"api","namespace":"time","status":"online","pid":1098,
            "mode":"fork_mode","cpu":2.5,"memoryBytes":4194304,"startedAt":1700000000123u64,"restarts":19,"watching":true,
            "cwd":"private-path","script":null,"version":null,"ports":null})
        );
        assert!(selected(rows, 7, "substituto").is_err());
    }

    #[test]
    fn preserves_status_and_distinguishes_missing_data_from_zero() {
        let rows = parse_list(br#"[{"pm_id":0,"name":"parado","pid":0,"pm2_env":{"status":"stopped","pm_uptime":1700000000123,"watch":false}}]"#).unwrap();
        let row = &rows[0];
        assert_eq!(row.status, "stopped");
        assert_eq!(row.pid, None);
        assert_eq!(row.started_at, None);
        assert_eq!(row.cpu, None);
        assert_eq!(row.memory_bytes, None);
        assert_eq!(row.restarts, None);
        assert!(!row.watching);
        assert!(parse_list(b"[]").unwrap().is_empty());
        assert!(parse_list(b"[PM2] offline").is_err());
        assert!(parse_list(br#"[{"pm_id":0}]"#).is_err());
    }

    #[test]
    fn scaling_requires_a_unique_cluster_group() {
        let data = br#"[{"pm_id":0,"name":"api","pm2_env":{"status":"online","exec_mode":"cluster_mode","namespace":"a","pm_exec_path":"same.js"}},
{"pm_id":1,"name":"api","pm2_env":{"status":"online","exec_mode":"cluster_mode","namespace":"b","pm_exec_path":"same.js"}}]"#;
        let compact: Vec<u8> = data.iter().copied().filter(|&c| c != b'\n').collect();
        let mut rows = parse_list(&compact).unwrap();
        assert!(cluster_size(&rows, 0, "api").is_err());
        rows[1].namespace = "a".into();
        assert_eq!(cluster_size(&rows, 0, "api").unwrap(), 2);
        rows[1].name = "elsewhere".into();
        rows[1].script = Some(std::path::absolute("api").unwrap());
        assert!(cluster_size(&rows, 0, "api").is_err());
        assert!(cluster_size(&rows, 0, "gone").is_err());
    }
}
