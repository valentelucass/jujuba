use crate::error::{AppError, Result};
use crate::pm2_ports;
use std::collections::HashSet;
use std::ffi::OsString;
use std::fs;
use std::io::{ErrorKind, Read};
use std::os::windows::{
    ffi::OsStringExt,
    fs::{MetadataExt, OpenOptionsExt},
    io::{AsRawHandle, FromRawHandle, OwnedHandle},
};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use windows_sys::Win32::{
    Foundation::FILETIME,
    System::{
        Pipes::GetNamedPipeServerProcessId,
        Threading::{
            GetProcessTimes, OpenProcess, QueryFullProcessImageNameW,
            PROCESS_QUERY_LIMITED_INFORMATION,
        },
    },
};

const RPC: &str = r"\\.\pipe\rpc.sock";
const PUB: &str = r"\\.\pipe\pub.sock";
const READ_LIST: &str = include_str!("pm2_protection.cjs");
const SECURITY_ANONYMOUS: u32 = 0;

fn uncertain() -> AppError {
    AppError::new("pm2_protection", "Não foi possível confirmar quais processos estão sob proteção do PM2. A otimização foi interrompida.")
}

fn pid_file() -> Result<PathBuf> {
    if let Some(file) = std::env::var_os("PM2_PID_FILE_PATH").filter(|p| !p.is_empty()) {
        return Ok(PathBuf::from(file));
    }
    std::env::var_os("PM2_HOME")
        .filter(|p| !p.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(|p| PathBuf::from(p).join(".pm2")))
        .map(|home| home.join("pm2.pid"))
        .ok_or_else(uncertain)
}

fn pipe_owner(pipe: &str) -> Result<Option<u32>> {
    // Opening an existing Windows named pipe can never launch its server.
    let pipe = match fs::OpenOptions::new()
        .read(true)
        .write(true)
        .security_qos_flags(SECURITY_ANONYMOUS)
        .open(pipe)
    {
        Ok(file) => file,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(uncertain()),
    };
    let mut pid = 0;
    if unsafe { GetNamedPipeServerProcessId(pipe.as_raw_handle(), &mut pid) } == 0 || pid == 0 {
        return Err(uncertain());
    }
    Ok(Some(pid))
}

fn read_pid(path: &Path) -> Result<Option<(u32, u64)>> {
    let file = match fs::OpenOptions::new()
        .read(true)
        .security_qos_flags(SECURITY_ANONYMOUS)
        .open(path)
    {
        Ok(f) => f,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(uncertain()),
    };
    let meta = file.metadata().map_err(|_| uncertain())?;
    if !meta.is_file() || meta.len() > 64 {
        return Err(uncertain());
    }
    let mut text = String::new();
    file.take(65)
        .read_to_string(&mut text)
        .map_err(|_| uncertain())?;
    if text.len() > 64 {
        return Err(uncertain());
    }
    let pid = text
        .trim()
        .parse::<u32>()
        .ok()
        .filter(|p| *p != 0)
        .ok_or_else(uncertain)?;
    Ok(Some((pid, meta.last_write_time())))
}

fn confirmed_pid(
    file: Option<(u32, u64)>,
    rpc: Option<u32>,
    published: Option<u32>,
) -> Result<Option<(u32, u64)>> {
    match (file, rpc, published) {
        (None, None, None) => Ok(None),
        (Some((pid, written)), Some(rpc), Some(published)) if pid == rpc && pid == published => {
            Ok(Some((pid, written)))
        }
        _ => Err(uncertain()),
    }
}

struct Daemon {
    pid: u32,
    node: PathBuf,
    // Holding a process handle keeps the Windows PID from being recycled during the RPC.
    _handle: OwnedHandle,
}

fn daemon(pid_path: &Path, rpc: &str, published: &str) -> Result<Option<Daemon>> {
    let Some((pid, written)) = confirmed_pid(
        read_pid(pid_path)?,
        pipe_owner(rpc)?,
        pipe_owner(published)?,
    )?
    else {
        return Ok(None);
    };
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        return Err(uncertain());
    }
    let handle = unsafe { OwnedHandle::from_raw_handle(handle) };
    let (mut creation, mut exit, mut kernel, mut user) = (
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
    );
    if unsafe {
        GetProcessTimes(
            handle.as_raw_handle(),
            &mut creation,
            &mut exit,
            &mut kernel,
            &mut user,
        )
    } == 0
    {
        return Err(uncertain());
    }
    let created = (u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime);
    if created > written.saturating_add(10_000_000)
        || exit.dwLowDateTime != 0
        || exit.dwHighDateTime != 0
    {
        return Err(uncertain());
    }
    let mut path = vec![0u16; 32768];
    let mut len = path.len() as u32;
    if unsafe { QueryFullProcessImageNameW(handle.as_raw_handle(), 0, path.as_mut_ptr(), &mut len) }
        == 0
    {
        return Err(uncertain());
    }
    let node = PathBuf::from(OsString::from_wide(&path[..len as usize]));
    if !node
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.eq_ignore_ascii_case("node.exe") || n.eq_ignore_ascii_case("bun.exe"))
    {
        return Err(uncertain());
    }
    Ok(Some(Daemon {
        pid,
        node,
        _handle: handle,
    }))
}

fn package() -> Result<PathBuf> {
    let path = std::env::var_os("PATH").unwrap_or_default();
    let npm = std::env::var_os("APPDATA").map(|p| PathBuf::from(p).join("npm"));
    for dir in std::env::split_paths(&path)
        .filter(|d| d.is_absolute())
        .chain(npm)
    {
        if ["pm2.cmd", "pm2.ps1", "pm2.exe"]
            .iter()
            .any(|name| dir.join(name).is_file())
        {
            for root in [dir.join("node_modules/pm2"), dir.join("../pm2")] {
                if root.join("package.json").is_file() {
                    return Ok(root);
                }
            }
        }
    }
    Err(uncertain())
}

async fn managed(node: &Path, package: &Path, pipe: &str) -> Result<HashSet<u32>> {
    let mut cmd = tokio::process::Command::new(node);
    cmd.args(["-e", READ_LIST])
        .arg(package)
        .arg(pipe)
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_V8_COVERAGE")
        .env_remove("NODE_COMPILE_CACHE")
        .env_remove("NODE_PATH")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .stdout(Stdio::piped())
        .kill_on_drop(true)
        .creation_flags(0x0800_0000);
    let output = tokio::time::timeout(Duration::from_secs(10), cmd.output())
        .await
        .map_err(|_| uncertain())?
        .map_err(|_| uncertain())?;
    if !output.status.success() || output.stdout.len() > 1024 * 1024 {
        return Err(uncertain());
    }
    serde_json::from_slice(&output.stdout).map_err(|_| uncertain())
}

pub(crate) async fn optimizer_protection() -> Result<HashSet<u32>> {
    protected_in(&pid_file()?, RPC, PUB).await
}

async fn protected_in(pid_path: &Path, rpc: &str, published: &str) -> Result<HashSet<u32>> {
    let Some(server) = daemon(pid_path, rpc, published)? else {
        return Ok(HashSet::new());
    };
    let mut roots = managed(&server.node, &package()?, rpc).await?;
    roots.insert(server.pid);
    if confirmed_pid(
        read_pid(pid_path)?,
        pipe_owner(rpc)?,
        pipe_owner(published)?,
    )?
    .map(|(pid, _)| pid)
        != Some(server.pid)
    {
        return Err(uncertain());
    }
    pm2_ports::protected_descendants(roots).ok_or_else(uncertain)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn returns_absent_only_when_pid_file_and_both_windows_endpoints_are_missing() {
        let file = Some((472, 42));
        assert_eq!(confirmed_pid(None, None, None).unwrap(), None);
        assert_eq!(confirmed_pid(file, Some(472), Some(472)).unwrap(), file);
        for (f, r, p) in [
            (file, None, None),
            (None, Some(472), Some(472)),
            (file, Some(472), None),
            (file, Some(474), Some(472)),
            (file, Some(474), Some(474)),
        ] {
            assert!(confirmed_pid(f, r, p).is_err());
        }
    }
}
