use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RankBasis {
    CpuCapacity,
    PhysicalMemory,
    GpuEngine,
    DiskActivity,
    ProcessIo,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RankStatus {
    Ready,
    Warming,
    Unavailable,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct ConsumerRow {
    pub(crate) pid: u32,
    pub(crate) name: String,
    pub(crate) value: f64,
    pub(crate) percent: f64,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct Rank<Row = ConsumerRow> {
    pub(crate) status: RankStatus,
    pub(crate) basis: RankBasis,
    pub(crate) rows: Vec<Row>,
}

impl<Row> Rank<Row> {
    pub(crate) fn warming(basis: RankBasis) -> Self {
        Self {
            status: RankStatus::Warming,
            basis,
            rows: vec![],
        }
    }

    pub(crate) fn unavailable(basis: RankBasis) -> Self {
        Self {
            status: RankStatus::Unavailable,
            basis,
            rows: vec![],
        }
    }
}

pub(super) type Values = Vec<(u32, String, f64)>;

pub(super) fn ranked(basis: RankBasis, mut values: Values, denominator: Option<f64>) -> Rank {
    values.retain(|(pid, name, value)| {
        *pid != 0 && !name.eq_ignore_ascii_case("_Total") && value.is_finite() && *value > 0.0
    });
    let total = denominator.unwrap_or_else(|| values.iter().map(|(_, _, v)| v).sum());
    values.sort_unstable_by(|a, b| b.2.total_cmp(&a.2).then_with(|| a.0.cmp(&b.0)));
    let rows = values
        .into_iter()
        .take(6)
        .map(|(pid, name, value)| ConsumerRow {
            pid,
            name,
            value,
            percent: (100.0 * value / total).min(100.0),
        })
        .collect();
    Rank {
        status: RankStatus::Ready,
        basis,
        rows,
    }
}

pub(crate) fn traffic_rank(basis: RankBasis, processes: Vec<(u32, String, f64)>) -> Rank {
    ranked(basis, processes, None)
}

#[derive(Debug, Clone, Copy)]
pub(super) struct Reading {
    pub first: i64,
    pub second: i64,
}

impl Reading {
    fn per_tick(self, before: Self) -> Option<f64> {
        let work = self.first.checked_sub(before.first)?;
        let time = self.second.checked_sub(before.second)?;
        (work >= 0 && time > 0).then(|| work as f64 / time as f64)
    }
}

pub(super) struct Process {
    pub name: String,
    pub started: Option<i64>,
    pub cpu: Option<Reading>,
    pub memory: Option<Reading>,
    pub io: Option<Reading>,
}

pub(super) type Processes = HashMap<u32, Process>;

pub(super) fn process_ranks(
    now: &Processes,
    before: Option<&Processes>,
    io_frequency: Option<f64>,
    logical_cpus: u32,
) -> (Rank, Rank) {
    let mut cpu = Vec::new();
    let mut io = Vec::new();
    for (&pid, p) in now {
        // Windows can recycle PIDs and duplicate executable names. The process creation
        // counter is stable for its lifetime, including when its PDH instance index changes.
        let previous = before
            .and_then(|b| b.get(&pid))
            .filter(|b| p.name == b.name && p.started.is_some() && p.started == b.started);
        if let Some(previous) = previous {
            if logical_cpus > 0 {
                if let Some(fraction) = p.cpu.zip(previous.cpu).and_then(|(v, b)| v.per_tick(b)) {
                    cpu.push((
                        pid,
                        p.name.clone(),
                        (100.0 * fraction / f64::from(logical_cpus)).min(100.0),
                    ));
                }
            }
            if let Some(bytes_per_second) =
                p.io.zip(previous.io)
                    .and_then(|(v, b)| v.per_tick(b))
                    .zip(io_frequency)
                    .map(|(bytes_per_tick, ticks_per_second)| bytes_per_tick * ticks_per_second)
            {
                io.push((pid, p.name.clone(), bytes_per_second));
            }
        }
    }
    let pending = |basis, usable| {
        if usable {
            Rank::warming(basis)
        } else {
            Rank::unavailable(basis)
        }
    };
    let cpu = if !cpu.is_empty() {
        ranked(RankBasis::CpuCapacity, cpu, Some(100.0))
    } else {
        pending(
            RankBasis::CpuCapacity,
            logical_cpus > 0 && now.values().any(|p| p.cpu.is_some() && p.started.is_some()),
        )
    };
    let io = if !io.is_empty() {
        traffic_rank(RankBasis::ProcessIo, io)
    } else {
        pending(
            RankBasis::ProcessIo,
            io_frequency.is_some() && now.values().any(|p| p.io.is_some() && p.started.is_some()),
        )
    };
    (cpu, io)
}

#[derive(Debug, Hash, Clone, Copy, PartialEq, Eq)]
pub(super) struct Engine {
    pid: u32,
    // Adapter LUID (high, low), physical adapter in a linked group, engine ordinal.
    device: (u32, u32, u32, u32),
}

impl Engine {
    pub(super) fn parse(name: &str) -> Option<Self> {
        let mut parts = name.split('_');
        if parts.next()? != "pid" {
            return None;
        }
        let pid = parts.next()?.parse().ok()?;
        if pid == 0 || parts.next()? != "luid" {
            return None;
        }
        let mut hex = || u32::from_str_radix(parts.next()?.strip_prefix("0x")?, 16).ok();
        let high = hex()?;
        let low = hex()?;
        if parts.next()? != "phys" {
            return None;
        }
        let physical = parts.next()?.parse().ok()?;
        if parts.next()? != "eng" {
            return None;
        }
        let ordinal = parts.next()?.parse().ok()?;
        Some(Self {
            pid,
            device: (high, low, physical, ordinal),
        })
    }
}

pub(super) type Engines = HashMap<Engine, Reading>;

pub(super) fn gpu_rank(
    now: &Engines,
    before: Option<&Engines>,
    processes: &Processes,
    previous_processes: Option<&Processes>,
) -> (Option<f64>, Rank) {
    if now.is_empty() {
        return (None, Rank::unavailable(RankBasis::GpuEngine));
    }
    let mut devices = HashMap::new();
    let mut pids = HashMap::new();
    for (&engine, &value) in now {
        let current = processes.get(&engine.pid);
        let old = previous_processes.and_then(|p| p.get(&engine.pid));
        if matches!((current,old), (Some(p),Some(b)) if p.started != b.started || p.name != b.name)
        {
            continue;
        }
        if let Some(v) = before
            .and_then(|b| b.get(&engine))
            .and_then(|&b| value.per_tick(b))
            .map(|fraction| 100.0 * fraction)
        {
            *devices.entry(engine.device).or_insert(0.0) += v;
            let top = pids.entry(engine.pid).or_insert(0.0_f64);
            *top = top.max(v.min(100.0));
        }
    }
    let Some(total) = devices.into_values().max_by(f64::total_cmp) else {
        return (None, Rank::warming(RankBasis::GpuEngine));
    };
    let values = pids
        .into_iter()
        .map(|(pid, v)| {
            let name = processes
                .get(&pid)
                .map(|p| p.name.clone())
                .unwrap_or_else(|| format!("PID {pid}"));
            (pid, name, v)
        })
        .collect();
    (
        Some(total.min(100.0)),
        ranked(RankBasis::GpuEngine, values, Some(100.0)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reading(first: i64, second: i64) -> Reading {
        Reading { first, second }
    }

    fn process(start: i64, cpu: i64, bytes: i64, time: i64) -> Process {
        Process {
            name: "app".into(),
            started: Some(start),
            memory: Some(reading(256, 0)),
            cpu: Some(reading(cpu, time)),
            io: Some(reading(bytes, time)),
        }
    }

    #[test]
    fn io_uses_the_entire_observed_total_before_selecting_six() {
        let mut values: Vec<_> = (1..=8).map(|p| (p, format!("app{p}"), 10.0)).collect();
        values.extend([
            (0, "Idle".into(), 700.0),
            (99, "_Total".into(), 100.0),
            (100, "bad".into(), f64::NAN),
        ]);
        let rank = traffic_rank(RankBasis::ProcessIo, values);
        assert_eq!(rank.status, RankStatus::Ready);
        assert_eq!(rank.rows.len(), 6);
        assert_eq!(rank.rows[0].pid, 1);
        assert_eq!(rank.rows[5].percent, 12.5);
    }

    #[test]
    fn normalizes_cpu_over_cores_and_io_over_provider_clock() {
        let before = Processes::from([(1, process(5, 0, 0, 20))]);
        let now = Processes::from([(1, process(5, 80, 160, 60))]);
        let (cpu, io) = process_ranks(&now, Some(&before), Some(10.0), 4);
        assert_eq!(cpu.rows[0].value, 50.0);
        assert_eq!(cpu.rows[0].percent, 50.0);
        assert_eq!(io.rows[0].value, 40.0);
        assert_eq!(io.rows[0].percent, 100.0);
    }

    #[test]
    fn distinguishes_missing_warming_measured_idle_and_recycled_pids() {
        let before = Processes::from([(1, process(5, 100, 30, 10))]);
        let idle = Processes::from([(1, process(5, 100, 30, 20))]);
        let changed = Processes::from([(1, process(6, 850, 999, 30))]);
        for (now, previous, status) in [
            (&before, None, RankStatus::Warming),
            (&before, Some(&before), RankStatus::Warming),
            (&idle, Some(&before), RankStatus::Ready),
            (&changed, Some(&before), RankStatus::Warming),
        ] {
            let (cpu, io) = process_ranks(now, previous, Some(10.0), 4);
            assert_eq!(cpu.status, status);
            assert!(cpu.rows.is_empty());
            assert_eq!(io.status, status);
            assert!(io.rows.is_empty());
        }
        let (cpu, io) = process_ranks(&before, None, None, 0);
        for rank in [cpu, io] {
            assert_eq!(rank.status, RankStatus::Unavailable);
        }
    }

    #[test]
    fn gpu_uses_peak_engine_per_pid_and_sums_only_matching_physical_engines() {
        let fixtures = [
            ("pid_1_luid_0x0_0xA_phys_0_eng_0_engtype_3D", 35),
            ("pid_2_luid_0x0_0xA_phys_0_eng_0_engtype_3D", 25),
            ("pid_1_luid_0x0_0xA_phys_0_eng_1_engtype_Copy", 50),
            ("pid_2_luid_0x0_0xB_phys_0_eng_0_engtype_3D", 44),
            ("pid_1_luid_0x0_0xA_phys_1_eng_0_engtype_3D", 30),
        ];
        let before: Engines = fixtures
            .iter()
            .map(|(s, _)| (Engine::parse(s).unwrap(), reading(400, 1000)))
            .collect();
        let after: Engines = fixtures
            .iter()
            .map(|(s, t)| (Engine::parse(s).unwrap(), reading(400 + t, 1100)))
            .collect();
        let (total, rank) = gpu_rank(&after, Some(&before), &Processes::new(), None);
        assert_eq!(total, Some(60.0));
        assert_eq!(rank.rows.len(), 2);
        assert_eq!(rank.rows[0].value, 50.0);
        assert_eq!(rank.rows[1].value, 44.0);
        assert!(Engine::parse("pid_0_luid_0x0_0xA_phys_0_eng_0").is_none());
        assert!(Engine::parse("pid_1_phys_0_eng_0").is_none());
        assert!(Engine::parse("_Total").is_none());
    }

    #[test]
    fn gpu_has_no_utilization_until_a_valid_interval_exists() {
        let engine = Engine::parse("pid_1_luid_0x0_0xA_phys_0_eng_0").unwrap();
        let base = Engines::from([(engine, reading(8, 40))]);
        let idle = Engines::from([(engine, reading(8, 80))]);
        let names = Processes::new();
        let empty = Engines::new();
        for (now, old, total, status) in [
            (&empty, None, None, RankStatus::Unavailable),
            (&base, None, None, RankStatus::Warming),
            (&idle, Some(&base), Some(0.0), RankStatus::Ready),
        ] {
            let (actual, rank) = gpu_rank(now, old, &names, None);
            assert_eq!(actual, total);
            assert_eq!(rank.status, status);
            assert!(rank.rows.is_empty());
        }
    }
}
