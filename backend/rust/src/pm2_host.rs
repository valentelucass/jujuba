use serde::Serialize;
use std::ptr::null_mut;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use windows_sys::Win32::System::{
    Performance::{
        PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterValue, PDH_CSTATUS_NEW_DATA,
        PDH_CSTATUS_VALID_DATA, PDH_FMT_COUNTERVALUE, PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY,
    },
    SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX},
    Threading::{GetActiveProcessorCount, ALL_PROCESSOR_GROUPS},
};

#[path = "pm2_host/pdh.rs"]
mod pdh;
#[path = "pm2_host/ranking.rs"]
mod ranking;
use ranking::{gpu_rank, process_ranks, Engines, Processes};
pub(crate) use ranking::{traffic_rank, Rank, RankBasis};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Consumers {
    cpu: Rank,
    memory: Rank,
    gpu: Rank,
    disk: Rank,
}

impl Default for Consumers {
    fn default() -> Self {
        Self {
            cpu: Rank::unavailable(RankBasis::CpuCapacity),
            memory: Rank::unavailable(RankBasis::PhysicalMemory),
            gpu: Rank::unavailable(RankBasis::GpuEngine),
            disk: Rank::unavailable(RankBasis::ProcessIo),
        }
    }
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostMetrics {
    cpu_percent: Option<f64>,
    memory_used_bytes: Option<u64>,
    memory_total_bytes: Option<u64>,
    gpu_percent: Option<f64>,
    disk_read_bytes_per_sec: Option<f64>,
    disk_write_bytes_per_sec: Option<f64>,
    consumers: Consumers,
}

struct Counters {
    query: PDH_HQUERY,
    cpu: PDH_HCOUNTER,
    cpu_legacy: PDH_HCOUNTER,
    read: PDH_HCOUNTER,
    write: PDH_HCOUNTER,
    gpu: PDH_HCOUNTER,
    process: pdh::ProcessCounters,
    previous_processes: Processes,
    previous_gpu: Engines,
    sampled: Option<Instant>,
}

// PDH handles belong to the query, independent of the calling thread.
// The mutex serializes all sampling and destruction.
unsafe impl Send for Counters {}

impl Counters {
    fn open() -> Option<Self> {
        let query = pdh::open_query()?;
        Some(Self {
            query,
            cpu: pdh::add(query, r"\Processor Information(_Total)\% Processor Time"),
            cpu_legacy: pdh::add(query, r"\Processor(_Total)\% Processor Time"),
            read: pdh::add(query, r"\PhysicalDisk(_Total)\Disk Read Bytes/sec"),
            write: pdh::add(query, r"\PhysicalDisk(_Total)\Disk Write Bytes/sec"),
            gpu: pdh::add(query, r"\GPU Engine(*)\Utilization Percentage"),
            process: pdh::ProcessCounters::attach(query, false),
            previous_processes: Processes::new(),
            previous_gpu: Engines::new(),
            sampled: None,
        })
    }

    fn update(&mut self, host: &mut HostMetrics) -> bool {
        if unsafe { PdhCollectQueryData(self.query) } != 0 {
            return false;
        }
        let processes = self.process.collect(self.query);
        let engines = pdh::engines(self.gpu);
        let now = Instant::now();
        let interval = self
            .sampled
            .replace(now)
            .map(|t| now - t)
            .filter(|d| !d.is_zero() && *d < Duration::from_secs(20));
        if interval.is_some() {
            host.cpu_percent = value(self.cpu)
                .or_else(|| value(self.cpu_legacy))
                .map(|v| v.min(100.0));
            host.disk_read_bytes_per_sec = value(self.read);
            host.disk_write_bytes_per_sec = value(self.write);
        }
        let previous = interval.map(|_| &self.previous_processes);
        let cpus = unsafe { GetActiveProcessorCount(ALL_PROCESSOR_GROUPS) };
        (
            host.consumers.cpu,
            host.consumers.memory,
            host.consumers.disk,
        ) = process_ranks(
            &processes,
            previous,
            self.process.io_frequency(),
            cpus,
            host.memory_total_bytes,
        );
        (host.gpu_percent, host.consumers.gpu) = gpu_rank(
            &engines,
            interval.map(|_| &self.previous_gpu),
            &processes,
            previous,
        );
        self.previous_processes = processes;
        self.previous_gpu = engines;
        true
    }
}

impl Drop for Counters {
    fn drop(&mut self) {
        unsafe { PdhCloseQuery(self.query) };
    }
}

fn value(handle: PDH_HCOUNTER) -> Option<f64> {
    if handle.is_null() {
        return None;
    }
    let mut counter = PDH_FMT_COUNTERVALUE::default();
    if unsafe { PdhGetFormattedCounterValue(handle, PDH_FMT_DOUBLE, null_mut(), &mut counter) } != 0
        || !matches!(
            counter.CStatus,
            PDH_CSTATUS_VALID_DATA | PDH_CSTATUS_NEW_DATA
        )
    {
        return None;
    }
    let number = unsafe { counter.Anonymous.doubleValue };
    (number.is_finite() && number >= 0.0).then_some(number)
}

pub(crate) fn sample(inspect_disk: bool) -> HostMetrics {
    static COUNTERS: OnceLock<Mutex<Option<Counters>>> = OnceLock::new();
    let mut host = HostMetrics::default();
    let mut memory = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    if unsafe { GlobalMemoryStatusEx(&mut memory) } != 0 {
        host.memory_total_bytes = Some(memory.ullTotalPhys);
        host.memory_used_bytes = memory.ullTotalPhys.checked_sub(memory.ullAvailPhys);
    }
    if let Ok(mut slot) = COUNTERS.get_or_init(|| Mutex::new(None)).lock() {
        if slot.is_none() {
            *slot = Counters::open();
        }
        if let Some(c) = slot.as_mut() {
            if !c.update(&mut host) {
                *slot = None;
            }
        }
    }
    if inspect_disk {
        if let Some(disk) = crate::pm2_disk_usage::sample() {
            host.consumers.disk = disk;
        }
    } else {
        host.consumers.disk = Rank::warming(RankBasis::DiskActivity);
    }
    host
}
