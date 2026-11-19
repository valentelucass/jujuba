use crate::pm2_host::{traffic_rank, Rank, RankBasis};
use std::collections::HashMap;
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use windows::System::Diagnostics::ProcessDiagnosticInfo;
use windows::Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED};

struct Apartment;

impl Apartment {
    fn enter() -> Option<Self> {
        unsafe { RoInitialize(RO_INIT_MULTITHREADED) }
            .ok()
            .map(|_| Self)
    }
}

impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe { RoUninitialize() };
    }
}

struct Reading {
    name: String,
    bytes: u64,
}

// Windows can reuse a PID as soon as a process exits.
type Processes = HashMap<(u32, i64), Reading>;

fn read() -> Option<Processes> {
    let list = ProcessDiagnosticInfo::GetForProcesses().ok()?;
    let count = list.Size().ok()?;
    let mut current = HashMap::new();
    for index in 0..count {
        let Ok(proc) = list.GetAt(index) else {
            continue;
        };
        let (Ok(pid), Ok(start)) = (proc.ProcessId(), proc.ProcessStartTime()) else {
            continue;
        };
        if pid == 0 {
            continue;
        }
        let Ok(report) = proc.DiskUsage().and_then(|usage| usage.GetReport()) else {
            continue;
        };
        let (Ok(read), Ok(written), Ok(image)) = (
            report.BytesReadCount(),
            report.BytesWrittenCount(),
            proc.ExecutableFileName(),
        ) else {
            continue;
        };
        if read < 0 || written < 0 {
            continue;
        }
        let executable = image.to_string_lossy();
        let name = executable.rsplit(['/', '\\']).next().unwrap_or_default();
        if !name.is_empty() {
            current.insert(
                (pid, start.UniversalTime),
                Reading {
                    name: name.to_owned(),
                    bytes: read as u64 + written as u64,
                },
            );
        }
    }
    // Some Windows editions or accounts expose just the calling app.
    (current.len() > 1).then_some(current)
}

fn rates(previous: &Processes, current: &Processes, seconds: f64) -> Vec<(u32, String, f64)> {
    current
        .iter()
        .filter_map(|(key, reading)| {
            let bytes = reading.bytes.checked_sub(previous.get(key)?.bytes)?;
            Some((key.0, reading.name.clone(), bytes as f64 / seconds))
        })
        .collect()
}

const MAX_AGE: Duration = Duration::from_secs(20);

fn measure(previous: &mut Option<(Instant, Processes)>) -> Option<Rank> {
    let Some(current) = read() else {
        *previous = None;
        return None;
    };
    let now = Instant::now();
    let rank = match previous.as_ref() {
        Some((time, base)) if now.duration_since(*time) < MAX_AGE => {
            let elapsed = now.duration_since(*time).as_secs_f64();
            if elapsed < 0.1 {
                return Some(Rank::warming(RankBasis::DiskActivity));
            }
            let values = rates(base, &current, elapsed);
            if values.is_empty() {
                Rank::warming(RankBasis::DiskActivity)
            } else {
                traffic_rank(RankBasis::DiskActivity, values)
            }
        }
        _ => Rank::warming(RankBasis::DiskActivity),
    };
    *previous = Some((now, current));
    Some(rank)
}

struct Worker {
    requests: mpsc::Sender<()>,
    results: mpsc::Receiver<(Instant, Option<Rank>)>,
    in_flight: bool,
    latest: Option<(Instant, Option<Rank>)>,
}

impl Worker {
    fn start() -> Option<Self> {
        let (requests, incoming) = mpsc::channel();
        let (outgoing, results) = mpsc::channel();
        std::thread::Builder::new()
            .name("jujuba-disk-usage".into())
            .spawn(move || {
                // Keep the MTA alive across reports. Releasing the last apartment between
                // readings can invalidate the cached ProcessDiagnosticInfo activation factory.
                let apartment = Apartment::enter();
                let mut previous = None;
                while incoming.recv().is_ok() {
                    let rank = apartment.as_ref().and_then(|_| measure(&mut previous));
                    if outgoing.send((Instant::now(), rank)).is_err() {
                        break;
                    }
                }
            })
            .ok()?;
        Some(Self {
            requests,
            results,
            in_flight: false,
            latest: None,
        })
    }

    fn sample(&mut self) -> Option<Rank> {
        match self.results.try_recv() {
            Ok(sample) => {
                self.latest = Some(sample);
                self.in_flight = false;
            }
            Err(mpsc::TryRecvError::Disconnected) => return None,
            Err(mpsc::TryRecvError::Empty) => {}
        }
        // Multiple webviews or rapid manual refreshes share at most one native scan.
        let age = self.latest.as_ref().map(|(time, _)| time.elapsed());
        if !self.in_flight && age.is_none_or(|age| age >= Duration::from_secs(1)) {
            self.requests.send(()).ok()?;
            self.in_flight = true;
        }
        if let Some((_, rank)) = self
            .latest
            .as_ref()
            .filter(|(time, _)| time.elapsed() < MAX_AGE)
        {
            rank.clone()
        } else {
            Some(Rank::warming(RankBasis::DiskActivity))
        }
    }
}

pub(crate) fn sample() -> Option<Rank> {
    static WORKER: OnceLock<Option<Mutex<Worker>>> = OnceLock::new();
    WORKER
        .get_or_init(|| Worker::start().map(Mutex::new))
        .as_ref()?
        .lock()
        .ok()?
        .sample()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn polling_shares_one_scan_expires_old_reports_and_relays_failure_to_fallback() {
        let (requests, incoming) = mpsc::channel();
        let (outgoing, results) = mpsc::channel();
        let mut worker = Worker {
            requests,
            results,
            in_flight: false,
            latest: None,
        };
        assert!(incoming.try_recv().is_err());
        for _ in 0..3 {
            assert!(worker.sample().unwrap().rows.is_empty());
        }
        assert!(incoming.try_recv().is_ok());
        assert!(incoming.try_recv().is_err());

        let old_rank = traffic_rank(RankBasis::DiskActivity, vec![(7, "app".into(), 100.0)]);
        outgoing
            .send((Instant::now() - MAX_AGE, Some(old_rank)))
            .unwrap();
        let waiting = worker.sample().unwrap();
        assert!(waiting.rows.is_empty());
        assert!(incoming.try_recv().is_ok());
        outgoing.send((Instant::now(), None)).unwrap();
        assert!(worker.sample().is_none());
        assert!(incoming.try_recv().is_err());
    }

    #[test]
    fn computes_disk_rate_only_for_matching_lifetimes_and_monotonic_counters() {
        let entry = |pid, start, bytes| {
            (
                (pid, start),
                Reading {
                    name: "app".into(),
                    bytes,
                },
            )
        };
        let before = Processes::from([entry(7, 1, 200), entry(8, 1, 300), entry(9, 1, 400)]);
        let after = Processes::from([entry(7, 1, 700), entry(8, 2, 800), entry(9, 1, 10)]);
        assert_eq!(rates(&before, &after, 2.0), vec![(7, "app".into(), 250.0)]);
    }
}
