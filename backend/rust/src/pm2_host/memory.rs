use super::ranking::{Processes, Rank, RankBasis, RankStatus};
use crate::pm2_ports;
use serde::Serialize;
use std::collections::HashMap;
use windows_sys::Win32::{
    Foundation::{CloseHandle, FILETIME},
    System::{
        SystemInformation::GetSystemTimePreciseAsFileTime,
        Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
    },
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MemoryRow {
    pid: u32,
    name: String,
    parent_pid: Option<u32>,
    // Preserve the full FILETIME across JSON/JavaScript's 53-bit number limit.
    started: Option<String>,
    value: Option<u64>,
    percent: Option<f64>,
}

struct Identity {
    name: String,
    parent: u32,
    started: Option<u64>,
}

fn ticks(time: FILETIME) -> u64 {
    (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime)
}

pub(super) fn now() -> u64 {
    let mut clock = FILETIME::default();
    unsafe { GetSystemTimePreciseAsFileTime(&mut clock) };
    ticks(clock)
}

fn birth(pid: u32) -> Option<u64> {
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() {
        return None;
    }
    let (mut start, mut exit, mut kernel, mut user) = (
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
    );
    let success =
        unsafe { GetProcessTimes(process, &mut start, &mut exit, &mut kernel, &mut user) };
    unsafe { CloseHandle(process) };
    (success != 0 && ticks(exit) == 0 && ticks(start) != 0).then_some(ticks(start))
}

fn image_stem(name: &str) -> &str {
    match name.rsplit_once('.') {
        Some((stem, ext)) if ext.eq_ignore_ascii_case("exe") => stem,
        _ => name,
    }
}

fn merge(
    identities: &HashMap<u32, Identity>,
    counters: &Processes,
    sampled: u64,
    total: Option<u64>,
) -> Rank<MemoryRow> {
    let physical = total.filter(|n| *n > 0);
    let mut rows = Vec::with_capacity(identities.len());
    for (&pid, item) in identities {
        let value = counters
            .get(&pid)
            .filter(|p| {
                // A PID could have been reused between the PDH and Toolhelp snapshots.
                // Never assign an older reading to a newly-created process or different image.
                item.started.is_none_or(|t| t <= sampled)
                    && image_stem(&p.name).eq_ignore_ascii_case(image_stem(&item.name))
            })
            .and_then(|p| p.memory)
            .and_then(|reading| u64::try_from(reading.first).ok());
        let parent_pid = identities
            .get(&item.parent)
            .and_then(|parent| parent.started.zip(item.started))
            .filter(|(parent, child)| parent < child)
            .map(|_| item.parent);
        rows.push(MemoryRow {
            pid,
            name: item.name.clone(),
            parent_pid,
            started: item.started.map(|t| t.to_string()),
            value,
            percent: value
                .zip(physical)
                .map(|(v, t)| 100.0 * v as f64 / t as f64),
        });
    }
    rows.sort_unstable_by(|a, b| b.value.cmp(&a.value).then_with(|| a.pid.cmp(&b.pid)));
    let status = if rows.iter().any(|row| row.value.is_some()) {
        RankStatus::Ready
    } else {
        RankStatus::Unavailable
    };
    Rank {
        basis: RankBasis::PhysicalMemory,
        status,
        rows,
    }
}

pub(super) fn inventory(counters: &Processes, sampled: u64, total: Option<u64>) -> Rank<MemoryRow> {
    let mut names = HashMap::new();
    let walked = pm2_ports::walk_processes(|entry| {
        if entry.th32ProcessID == 0 {
            return;
        }
        let length = entry
            .szExeFile
            .iter()
            .position(|ch| *ch == 0)
            .unwrap_or(entry.szExeFile.len());
        let name = if length > 0 {
            String::from_utf16_lossy(&entry.szExeFile[..length])
        } else {
            format!("PID {}", entry.th32ProcessID)
        };
        names.insert(
            entry.th32ProcessID,
            Identity {
                name,
                parent: entry.th32ParentProcessID,
                started: birth(entry.th32ProcessID),
            },
        );
    });
    if walked.is_none() {
        // A failed enumeration cannot prove a parent link. PDH independently supplies
        // measured processes and names even if this Windows snapshot failed.
        names = counters
            .iter()
            .map(|(&pid, p)| {
                (
                    pid,
                    Identity {
                        name: p.name.clone(),
                        parent: 0,
                        started: birth(pid),
                    },
                )
            })
            .collect();
    }
    merge(&names, counters, sampled, total)
}

#[cfg(test)]
mod tests {
    use super::super::ranking::{Process, Reading};
    use super::*;
    fn identity(name: &str, parent: u32, started: Option<u64>) -> Identity {
        Identity {
            name: name.to_owned(),
            parent,
            started,
        }
    }
    fn counter(name: &str, value: i64) -> Process {
        Process {
            name: name.to_owned(),
            started: None,
            cpu: None,
            memory: Some(Reading {
                first: value,
                second: 0,
            }),
            io: None,
        }
    }
    #[test]
    fn returns_every_process_including_measured_zero_and_inaccessible_or_unmeasured() {
        let mut names: HashMap<_, _> = (1..=9)
            .map(|pid| (pid, identity("node.exe", 0, Some(u64::from(pid)))))
            .collect();
        names.insert(10, identity("Protected.exe", 0, None));
        let mut counters: Processes = (1..=8)
            .map(|p| (p, counter("node", i64::from(p) * 10)))
            .collect();
        counters.insert(9, counter("node", 0));
        let list = merge(&names, &counters, 100, Some(1000));
        assert_eq!(list.status, RankStatus::Ready);
        assert_eq!(list.rows.len(), 10);
        assert_eq!((list.rows[0].pid, list.rows[0].percent), (8, Some(8.0)));
        assert_eq!(list.rows[8].value, Some(0));
        assert_eq!(list.rows[9].percent, None);
        assert_eq!(list.rows[9].started, None);
        let offline = merge(&names, &Processes::new(), 100, None);
        assert_eq!(offline.status, RankStatus::Unavailable);
        assert_eq!(offline.rows.len(), 10);
        assert!(offline.rows.iter().all(|r| r.value.is_none()));
    }
    #[test]
    fn rejects_reused_pids_different_images_and_parents_of_uncertain_age() {
        let names = HashMap::from([
            (1, identity("pm2.exe", 0, Some(5))),
            (2, identity("node.exe", 1, Some(80))),
            (3, identity("worker.exe", 2, Some(25))),
            (4, identity("other.exe", 1, None)),
            (5, identity("new.exe", 1, Some(20))),
        ]);
        let readings = Processes::from([
            (2, counter("node", 999)),
            (3, counter("worker", 10)),
            (5, counter("old", 20)),
        ]);
        let inventory = merge(&names, &readings, 50, Some(100));
        let row = |pid| inventory.rows.iter().find(|r| r.pid == pid).unwrap();
        assert_eq!(row(2).value, None);
        assert_eq!(row(2).parent_pid, Some(1));
        assert_eq!(row(3).value, Some(10));
        assert_eq!(row(3).parent_pid, None);
        assert_eq!(row(4).parent_pid, None);
        assert_eq!(row(5).value, None);
    }

    #[test]
    fn win32_inventory_keeps_the_live_process_when_pdh_does_not_return_private_ram() {
        let report = inventory(&Processes::new(), now(), None);
        let me = report
            .rows
            .iter()
            .find(|r| r.pid == std::process::id())
            .unwrap();
        assert!(!me.name.is_empty());
        assert!(me.started.is_some());
        assert_eq!(me.value, None);
        assert_eq!(me.percent, None);
        assert_eq!(report.status, RankStatus::Unavailable);
    }
}
