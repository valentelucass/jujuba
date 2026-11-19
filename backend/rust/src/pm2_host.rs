use serde::Serialize;
use std::ptr::{null, null_mut};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use windows_sys::Win32::System::{
    Performance::{
        PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterValue,
        PdhOpenQueryW, PDH_CSTATUS_NEW_DATA, PDH_CSTATUS_VALID_DATA, PDH_FMT_COUNTERVALUE,
        PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY,
    },
    SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX},
};

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostMetrics {
    cpu_percent: Option<f64>,
    memory_used_bytes: Option<u64>,
    memory_total_bytes: Option<u64>,
    disk_read_bytes_per_sec: Option<f64>,
    disk_write_bytes_per_sec: Option<f64>,
}

struct Counters {
    query: PDH_HQUERY,
    cpu: PDH_HCOUNTER,
    read: PDH_HCOUNTER,
    write: PDH_HCOUNTER,
    sampled: Option<Instant>,
}

// PDH handles belong to the query, independent of the calling thread.
// The mutex serializes all sampling and destruction.
unsafe impl Send for Counters {}

impl Counters {
    fn open() -> Option<Self> {
        let mut query = null_mut();
        if unsafe { PdhOpenQueryW(null(), 0, &mut query) } != 0 {
            return None;
        }
        let add = |path: &str| {
            let wide: Vec<_> = path.encode_utf16().chain(Some(0)).collect();
            let mut handle = null_mut();
            if unsafe { PdhAddEnglishCounterW(query, wide.as_ptr(), 0, &mut handle) } == 0 {
                handle
            } else {
                null_mut()
            }
        };
        Some(Self {
            query,
            cpu: add(r"\Processor(_Total)\% Processor Time"),
            read: add(r"\PhysicalDisk(_Total)\Disk Read Bytes/sec"),
            write: add(r"\PhysicalDisk(_Total)\Disk Write Bytes/sec"),
            sampled: None,
        })
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
        || !matches!(counter.CStatus, PDH_CSTATUS_VALID_DATA | PDH_CSTATUS_NEW_DATA)
    {
        return None;
    }
    let number = unsafe { counter.Anonymous.doubleValue };
    (number.is_finite() && number >= 0.0).then_some(number)
}

pub(crate) fn sample() -> HostMetrics {
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
    let Ok(mut slot) = COUNTERS.get_or_init(|| Mutex::new(None)).lock() else {
        return host;
    };
    if slot.is_none() {
        *slot = Counters::open();
    }
    if let Some(counters) = slot.as_mut() {
        if unsafe { PdhCollectQueryData(counters.query) } != 0 {
            *slot = None;
        } else {
            let now = Instant::now();
            if counters.sampled.replace(now).is_some_and(|t| now - t < Duration::from_secs(20)) {
                host.cpu_percent = value(counters.cpu).map(|v| v.min(100.0));
                host.disk_read_bytes_per_sec = value(counters.read);
                host.disk_write_bytes_per_sec = value(counters.write);
            }
        }
    }
    host
}
