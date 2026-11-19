use crate::error::{AppError, Result};
use crate::pm2_ports;
use std::collections::{HashMap, HashSet};
use std::mem::size_of;
use std::ptr::null;
use windows_sys::Win32::{
    Foundation::{GetLastError, ERROR_MORE_DATA},
    System::Services::{
        CloseServiceHandle, EnumServicesStatusExW, OpenSCManagerW, ENUM_SERVICE_STATUS_PROCESSW,
        SC_ENUM_PROCESS_INFO, SC_HANDLE, SC_MANAGER_ENUMERATE_SERVICE, SERVICE_ACTIVE,
        SERVICE_WIN32,
    },
};

pub(crate) struct HostProtection {
    pub(crate) parents: HashMap<u32, u32>,
    pub(crate) names: HashMap<u32, String>,
    protected: HashSet<u32>,
}

impl HostProtection {
    pub(crate) fn is_protected(&self, pid: u32) -> bool {
        !self.parents.contains_key(&pid) || self.protected.contains(&pid)
    }
}

fn unavailable() -> AppError {
    AppError::new("optimizer_protection", "O Windows não confirmou os processos, serviços e conexões em uso. A otimização foi interrompida.")
}

struct ServiceManager(SC_HANDLE);
impl Drop for ServiceManager {
    fn drop(&mut self) {
        unsafe { CloseServiceHandle(self.0) };
    }
}

fn service_pids() -> Option<HashSet<u32>> {
    let handle = unsafe { OpenSCManagerW(null(), null(), SC_MANAGER_ENUMERATE_SERVICE) };
    if handle.is_null() {
        return None;
    }
    let manager = ServiceManager(handle);
    // EnumServicesStatusEx supports pages up to 256 KiB. Names need space too, but we
    // only read the fixed, aligned status entries, never service config or credentials.
    let mut buffer = vec![0usize; (256 * 1024) / size_of::<usize>()];
    let capacity = (size_of::<usize>() * buffer.len()) as u32;
    let mut cursor = 0;
    let mut pids = HashSet::new();
    loop {
        let previous = cursor;
        let (mut needed, mut count) = (0, 0);
        let ok = unsafe {
            EnumServicesStatusExW(
                manager.0,
                SC_ENUM_PROCESS_INFO,
                SERVICE_WIN32,
                SERVICE_ACTIVE,
                buffer.as_mut_ptr().cast(),
                capacity,
                &mut needed,
                &mut count,
                &mut cursor,
                null(),
            )
        };
        if ok == 0 && unsafe { GetLastError() } != ERROR_MORE_DATA {
            return None;
        }
        if count as usize > capacity as usize / size_of::<ENUM_SERVICE_STATUS_PROCESSW>() {
            return None;
        }
        let services = unsafe {
            std::slice::from_raw_parts(
                buffer.as_ptr().cast::<ENUM_SERVICE_STATUS_PROCESSW>(),
                count as usize,
            )
        };
        pids.extend(
            services
                .iter()
                .map(|row| row.ServiceStatusProcess.dwProcessId)
                .filter(|pid| *pid != 0),
        );
        if ok != 0 {
            return (!pids.is_empty()).then_some(pids);
        }
        if cursor == previous || count == 0 {
            return None;
        }
    }
}

// A portable or user-launched engine, maintenance utility or host might have neither
// an SCM record nor a socket at the moment of inspection. Protect its whole subtree.
fn infrastructure(image: &str) -> bool {
    let name = image.strip_suffix(".exe").unwrap_or(image);
    matches!(
        name,
        "services"
            | "svchost"
            | "taskhostw"
            | "taskeng"
            | "sqlservr"
            | "sqlagent"
            | "sqlbrowser"
            | "sqlwriter"
            | "sqlcmd"
            | "ssms"
            | "fdhost"
            | "postgres"
            | "postmaster"
            | "psql"
            | "pgagent"
            | "pgadmin4"
            | "pgbouncer"
            | "oracle"
            | "tnslsnr"
            | "sqlplus"
            | "firebird"
            | "fbserver"
            | "fbguard"
            | "isql"
            | "sqlite3"
            | "duckdb"
            | "cockroach"
            | "influxd"
            | "couchdb"
            | "neo4j"
            | "rqlited"
            | "node"
            | "bun"
            | "deno"
            | "pm2"
            | "dotnet"
            | "java"
            | "javaw"
            | "php"
            | "ruby"
            | "perl"
            | "wsl"
            | "wslhost"
            | "wslservice"
            | "docker"
            | "dockerd"
            | "containerd"
            | "vmcompute"
            | "vmmem"
            | "vmmemwsl"
            | "cmd"
            | "conhost"
            | "openconsole"
            | "pwsh"
            | "powershell"
            | "sshd"
            | "lsass"
            | "msmpeng"
            | "nissrv"
            | "mssense"
            | "securityhealthservice"
            | "smartscreen"
            | "vssvc"
            | "wbengine"
            | "wbadmin"
            | "diskshadow"
            | "robocopy"
            | "restic"
            | "rclone"
            | "onedrive"
    ) || [
        "mssql",
        "mysql",
        "maria",
        "mongo",
        "redis-",
        "valkey-",
        "memurai",
        "pg_",
        "db2",
        "dbsrv",
        "dbeng",
        "python",
        "veeam",
        "acronis",
        "duplicati",
        "senseir",
        "csfalcon",
    ]
    .iter()
    .any(|prefix| name.starts_with(prefix))
}

fn combine(
    parents: HashMap<u32, u32>,
    names: HashMap<u32, String>,
    mut roots: HashSet<u32>,
    sockets: HashSet<u32>,
) -> HostProtection {
    roots.extend(sockets);
    let mut protected = pm2_ports::descendants(&parents, roots);
    // Protect hosts with live children, including all ancestors of infrastructure. Do this
    // after walking the sensitive roots so a sibling does not inherit an unrelated child's status.
    protected.extend(parents.values().copied());
    protected.insert(std::process::id());
    protected.insert(0);
    HostProtection {
        parents,
        names,
        protected,
    }
}

pub(crate) fn snapshot(mut pm2: HashSet<u32>) -> Result<HostProtection> {
    pm2.extend(service_pids().ok_or_else(unavailable)?);
    let sockets = pm2_ports::network_owners().ok_or_else(unavailable)?;
    let mut parents = HashMap::new();
    let mut names = HashMap::new();
    pm2_ports::walk_processes(|entry| {
        let pid = entry.th32ProcessID;
        parents.insert(pid, entry.th32ParentProcessID);
        let length = entry
            .szExeFile
            .iter()
            .position(|ch| *ch == 0)
            .unwrap_or(entry.szExeFile.len());
        let image = String::from_utf16_lossy(&entry.szExeFile[..length]);
        if image.is_empty() || infrastructure(&image.to_ascii_lowercase()) {
            pm2.insert(pid);
        }
        if !image.is_empty() {
            names.insert(pid, image);
        }
    })
    .ok_or_else(unavailable)?;
    Ok(combine(parents, names, pm2, sockets))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_sensitive_descendants_live_parents_socket_owners_and_unknown_pids() {
        let parents = HashMap::from([
            (1, 0),
            (2, 1),
            (3, 2),
            (4, 3),
            (5, 1),
            (6, 5),
            (7, 1),
            (8, 7),
            (9, 8),
            (10, 1),
        ]);
        let guard = combine(
            parents,
            HashMap::new(),
            HashSet::from([2]),
            HashSet::from([7]),
        );
        for pid in [0, 1, 2, 3, 4, 5, 7, 8, 9, 99] {
            assert!(guard.is_protected(pid));
        }
        assert!(!guard.is_protected(6));
        assert!(!guard.is_protected(10));
    }

    #[test]
    fn recognizes_user_launched_engines_helpers_and_runtime_hosts() {
        for image in [
            "postgres.exe",
            "pg_dump.exe",
            "mongod.exe",
            "mariadbd.exe",
            "redis-server.exe",
            "sqlservr.exe",
            "node.exe",
            "python3.exe",
            "wbengine.exe",
            "msmpeng.exe",
        ] {
            assert!(infrastructure(image));
        }
        assert!(!infrastructure("mspaint.exe"));
    }

    #[test]
    fn windows_detects_live_service_hosts_and_local_udp_owner() {
        let services = service_pids().unwrap();
        assert!(!services.is_empty());
        let _ipv4 = std::net::UdpSocket::bind(("127.0.0.1", 0)).unwrap();
        let _ipv6 = std::net::UdpSocket::bind(("::1", 0)).unwrap();
        assert!(pm2_ports::network_owners()
            .unwrap()
            .contains(&std::process::id()));
        let guard = snapshot(HashSet::new()).unwrap();
        assert!(services
            .iter()
            .filter(|pid| guard.parents.contains_key(pid))
            .all(|pid| guard.is_protected(*pid)));
    }
}
