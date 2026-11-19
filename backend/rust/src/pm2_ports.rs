use std::collections::{BTreeSet, HashMap, HashSet};
use std::mem::{offset_of, size_of};
use windows_sys::Win32::{
    Foundation::{
        CloseHandle, GetLastError, ERROR_INSUFFICIENT_BUFFER, ERROR_NO_MORE_FILES,
        INVALID_HANDLE_VALUE,
    },
    NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCP6ROW_OWNER_PID, MIB_TCP6TABLE_OWNER_PID, MIB_TCPROW_OWNER_PID,
        MIB_TCPTABLE_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER,
    },
    Networking::WinSock::{AF_INET, AF_INET6},
    System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    },
};

fn walk_processes(mut visit: impl FnMut(&PROCESSENTRY32W)) -> Option<()> {
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
fn listeners<Row: Copy>(
    family: u16,
    offset: usize,
    fields: impl Fn(Row) -> (u32, u32),
) -> Option<Vec<(u32, u16)>> {
    let mut data = Vec::<u32>::new();
    let mut bytes = 0u32;
    for _ in 0..4 {
        let buffer = if data.is_empty() {
            std::ptr::null_mut()
        } else {
            data.as_mut_ptr().cast()
        };
        let status = unsafe {
            GetExtendedTcpTable(
                buffer,
                &mut bytes,
                0,
                u32::from(family),
                TCP_TABLE_OWNER_PID_LISTENER,
                0,
            )
        };
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
                .map(|i| {
                    let (pid, port) = fields(unsafe { first.add(i).read_unaligned() });
                    (pid, u16::from_be(port as u16))
                })
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

pub(crate) fn sample(managed: &HashSet<u32>) -> Option<HashMap<u32, BTreeSet<u16>>> {
    if managed.is_empty() {
        return Some(HashMap::new());
    }
    let mut parents = HashMap::new();
    walk_processes(|entry| {
        parents.insert(entry.th32ProcessID, entry.th32ParentProcessID);
    })?;
    let ipv4 = listeners(
        AF_INET,
        offset_of!(MIB_TCPTABLE_OWNER_PID, table),
        |r: MIB_TCPROW_OWNER_PID| (r.dwOwningPid, r.dwLocalPort),
    )?;
    let ipv6 = listeners(
        AF_INET6,
        offset_of!(MIB_TCP6TABLE_OWNER_PID, table),
        |r: MIB_TCP6ROW_OWNER_PID| (r.dwOwningPid, r.dwLocalPort),
    )?;
    Some(group(ipv4.into_iter().chain(ipv6), &parents, managed))
}

#[cfg(test)]
mod tests {
    use super::*;
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
