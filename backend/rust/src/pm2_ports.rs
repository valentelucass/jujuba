use std::collections::{BTreeSet, HashMap, HashSet};
use std::ffi::c_void;
use std::mem::{offset_of, size_of};
use windows_sys::Win32::{
    Foundation::{
        CloseHandle, GetLastError, ERROR_INSUFFICIENT_BUFFER, ERROR_NO_MORE_FILES,
        INVALID_HANDLE_VALUE,
    },
    NetworkManagement::IpHelper::{
        GetExtendedTcpTable, GetExtendedUdpTable, MIB_TCP6ROW_OWNER_PID, MIB_TCP6TABLE_OWNER_PID,
        MIB_TCPROW_OWNER_PID, MIB_TCPTABLE_OWNER_PID, MIB_UDP6ROW_OWNER_PID,
        MIB_UDP6TABLE_OWNER_PID, MIB_UDPROW_OWNER_PID, MIB_UDPTABLE_OWNER_PID, TCP_TABLE_CLASS,
        TCP_TABLE_OWNER_PID_ALL, TCP_TABLE_OWNER_PID_LISTENER, UDP_TABLE_OWNER_PID,
    },
    Networking::WinSock::{AF_INET, AF_INET6},
    System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    },
};

pub(crate) fn walk_processes(mut visit: impl FnMut(&PROCESSENTRY32W)) -> Option<()> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return None;
    }
    let mut entry = PROCESSENTRY32W {
        dwSize: size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut found = unsafe { Process32FirstW(snapshot, &mut entry) };
    while found != 0 {
        visit(&entry);
        found = unsafe { Process32NextW(snapshot, &mut entry) };
    }
    let complete = unsafe { GetLastError() } == ERROR_NO_MORE_FILES;
    unsafe {
        CloseHandle(snapshot);
    }
    complete.then_some(())
}

pub(crate) fn parents() -> Option<HashMap<u32, u32>> {
    let mut tree = HashMap::new();
    walk_processes(|entry| {
        tree.insert(entry.th32ProcessID, entry.th32ParentProcessID);
    })?;
    Some(tree)
}

pub(crate) fn descendants(tree: &HashMap<u32, u32>, mut protected: HashSet<u32>) -> HashSet<u32> {
    protected.remove(&0);
    let mut children = HashMap::<u32, Vec<u32>>::new();
    for (&pid, &parent) in tree {
        if pid != 0 {
            children.entry(parent).or_default().push(pid);
        }
    }
    let mut pending: Vec<_> = protected.iter().copied().collect();
    while let Some(parent) = pending.pop() {
        for child in children.remove(&parent).unwrap_or_default() {
            if protected.insert(child) {
                pending.push(child);
            }
        }
    }
    protected
}

pub(super) fn protected_descendants(roots: HashSet<u32>) -> Option<HashSet<u32>> {
    Some(descendants(&parents()?, roots))
}

pub(crate) fn cli_children(powershell: u32) -> Vec<u32> {
    let mut children = Vec::new();
    let mut wrappers = Vec::new();
    let mut parents = Vec::new();
    let _ = walk_processes(|entry| {
        parents.push((entry.th32ProcessID, entry.th32ParentProcessID));
        if entry.th32ParentProcessID == powershell {
            children.push(entry.th32ProcessID);
            let end = entry
                .szExeFile
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(entry.szExeFile.len());
            if String::from_utf16_lossy(&entry.szExeFile[..end]).eq_ignore_ascii_case("cmd.exe") {
                wrappers.push(entry.th32ProcessID);
            }
        }
    });
    children.extend(
        parents
            .into_iter()
            .filter_map(|(pid, parent)| wrappers.contains(&parent).then_some(pid)),
    );
    children
}

// Windows returns a DWORD row count, table padding and a variable-length C array.
// DWORD storage supplies the alignment required by both the IPv4 and IPv6 tables.
fn network_table<Row: Copy, T>(
    read: impl Fn(*mut c_void, &mut u32) -> u32,
    offset: usize,
    fields: impl Fn(Row) -> T,
) -> Option<Vec<T>> {
    let mut data = Vec::<u32>::new();
    let mut bytes = 0u32;
    for _ in 0..4 {
        let buffer = if data.is_empty() {
            std::ptr::null_mut()
        } else {
            data.as_mut_ptr().cast()
        };
        let status = read(buffer, &mut bytes);
        if status == ERROR_INSUFFICIENT_BUFFER && bytes <= 32 * 1024 * 1024 {
            data.resize((bytes as usize).div_ceil(size_of::<u32>()), 0);
            continue;
        }
        if status != 0 {
            return None;
        }
        let count = *data.first()? as usize;
        let capacity = data.len() * size_of::<u32>();
        if count > capacity.checked_sub(offset)? / size_of::<Row>() {
            return None;
        }
        let first = unsafe { data.as_ptr().cast::<u8>().add(offset).cast::<Row>() };
        return Some(
            (0..count)
                .map(|i| fields(unsafe { first.add(i).read_unaligned() }))
                .collect(),
        );
    }
    None
}

fn group(
    listeners: impl Iterator<Item = (u32, u16)>,
    parents: &HashMap<u32, u32>,
    managed: &HashSet<u32>,
) -> HashMap<u32, BTreeSet<u16>> {
    let mut result = HashMap::new();
    for (mut owner, port) in listeners {
        let mut seen = HashSet::new();
        while owner != 0 && seen.insert(owner) {
            if managed.contains(&owner) {
                result
                    .entry(owner)
                    .or_insert_with(BTreeSet::new)
                    .insert(port);
                break;
            }
            let Some(parent) = parents.get(&owner) else {
                break;
            };
            owner = *parent;
        }
    }
    result
}

fn tcp(class: TCP_TABLE_CLASS) -> Option<impl Iterator<Item = (u32, u16)>> {
    let table = |family: u16| {
        move |buf, len: &mut u32| unsafe {
            GetExtendedTcpTable(buf, len, 0, u32::from(family), class, 0)
        }
    };
    let ipv4 = network_table(
        table(AF_INET),
        offset_of!(MIB_TCPTABLE_OWNER_PID, table),
        |r: MIB_TCPROW_OWNER_PID| (r.dwOwningPid, u16::from_be(r.dwLocalPort as u16)),
    )?;
    let ipv6 = network_table(
        table(AF_INET6),
        offset_of!(MIB_TCP6TABLE_OWNER_PID, table),
        |r: MIB_TCP6ROW_OWNER_PID| (r.dwOwningPid, u16::from_be(r.dwLocalPort as u16)),
    )?;
    Some(ipv4.into_iter().chain(ipv6))
}

pub(crate) fn network_owners() -> Option<HashSet<u32>> {
    let table = |family: u16| {
        move |buf, len: &mut u32| unsafe {
            GetExtendedUdpTable(buf, len, 0, u32::from(family), UDP_TABLE_OWNER_PID, 0)
        }
    };
    let ipv4 = network_table(
        table(AF_INET),
        offset_of!(MIB_UDPTABLE_OWNER_PID, table),
        |r: MIB_UDPROW_OWNER_PID| r.dwOwningPid,
    )?;
    let ipv6 = network_table(
        table(AF_INET6),
        offset_of!(MIB_UDP6TABLE_OWNER_PID, table),
        |r: MIB_UDP6ROW_OWNER_PID| r.dwOwningPid,
    )?;
    Some(
        tcp(TCP_TABLE_OWNER_PID_ALL)?
            .map(|(pid, _)| pid)
            .chain(ipv4)
            .chain(ipv6)
            .filter(|pid| *pid != 0)
            .collect(),
    )
}

pub(crate) fn sample(managed: &HashSet<u32>) -> Option<HashMap<u32, BTreeSet<u16>>> {
    if managed.is_empty() {
        return Some(HashMap::new());
    }
    Some(group(
        tcp(TCP_TABLE_OWNER_PID_LISTENER)?,
        &parents()?,
        managed,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn protects_daemon_managed_workers_wrappers_and_every_descendant() {
        let tree = HashMap::from([
            (10, 1),
            (20, 10),
            (30, 20),
            (40, 30),
            (50, 80),
            (60, 50),
            (65, 60),
            (70, 1),
            (80, 1),
            (91, 92),
            (92, 91),
        ]);
        assert_eq!(
            descendants(&tree, HashSet::from([0, 10, 50, 91])),
            HashSet::from([10, 20, 30, 40, 50, 60, 65, 91, 92])
        );
        assert!(descendants(&tree, HashSet::new()).is_empty());
    }

    #[test]
    fn assigns_each_listener_to_its_nearest_managed_ancestor() {
        let tree = HashMap::from([(2, 1), (3, 2), (4, 3), (5, 1), (7, 8), (8, 7)]);
        let ports = group(
            [
                (1, 81),
                (4, 80),
                (3, 80),
                (2, 443),
                (5, 82),
                (99, 90),
                (7, 101),
            ]
            .into_iter(),
            &tree,
            &HashSet::from([1, 2]),
        );
        assert_eq!(
            ports,
            HashMap::from([
                (1, BTreeSet::from([81, 82])),
                (2, BTreeSet::from([80, 443]))
            ])
        );
    }
    #[test]
    fn reads_the_live_windows_listening_sockets() {
        let v4 = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let v6 = std::net::TcpListener::bind(("::1", 0)).unwrap();
        let pid = std::process::id();
        let ports = sample(&HashSet::from([pid])).unwrap();
        assert!(ports[&pid].contains(&v4.local_addr().unwrap().port()));
        assert!(ports[&pid].contains(&v6.local_addr().unwrap().port()));
    }
}
