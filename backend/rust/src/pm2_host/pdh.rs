use super::ranking::{Engine, Engines, Process, Processes, Reading};
use std::mem::size_of;
use std::ptr::{null, null_mut};
use windows_sys::Win32::System::Performance::*;

pub(super) fn add(query: PDH_HQUERY, path: &str) -> PDH_HCOUNTER {
    let wide: Vec<_> = path.encode_utf16().chain(Some(0)).collect();
    let mut handle = null_mut();
    if unsafe { PdhAddEnglishCounterW(query, wide.as_ptr(), 0, &mut handle) } == 0 {
        handle
    } else {
        null_mut()
    }
}

type Items = Vec<(String, Option<Reading>)>;

fn raw(handle: PDH_HCOUNTER) -> Option<Items> {
    if handle.is_null() {
        return None;
    }
    // PDH fills a single native buffer containing aligned structures and their UTF-16 names.
    for _ in 0..3 {
        let (mut bytes, mut count) = (0, 0);
        let status = unsafe { PdhGetRawCounterArrayW(handle, &mut bytes, &mut count, null_mut()) };
        if status != PDH_MORE_DATA || bytes == 0 || bytes > 32 * 1024 * 1024 {
            return None;
        }
        let mut buffer = vec![0u64; (bytes as usize).div_ceil(size_of::<u64>())];
        let status = unsafe {
            PdhGetRawCounterArrayW(handle, &mut bytes, &mut count, buffer.as_mut_ptr().cast())
        };
        if status == PDH_MORE_DATA {
            continue;
        }
        let length = bytes as usize;
        if status != 0
            || length > buffer.len() * size_of::<u64>()
            || count as usize > length / size_of::<PDH_RAW_COUNTER_ITEM_W>()
        {
            return None;
        }
        let items = unsafe {
            std::slice::from_raw_parts(
                buffer.as_ptr().cast::<PDH_RAW_COUNTER_ITEM_W>(),
                count as usize,
            )
        };
        let base = buffer.as_ptr() as usize;
        let mut values = Vec::with_capacity(items.len());
        for item in items {
            let offset = (item.szName as usize).checked_sub(base)?;
            if offset >= length || offset % size_of::<u16>() != 0 {
                return None;
            }
            let text = unsafe {
                std::slice::from_raw_parts(item.szName, (length - offset) / size_of::<u16>())
            };
            let end = text.iter().position(|&u| u == 0)?;
            let name = String::from_utf16_lossy(&text[..end]);
            let r = item.RawValue;
            let value = (matches!(r.CStatus, PDH_CSTATUS_VALID_DATA | PDH_CSTATUS_NEW_DATA)
                && r.FirstValue >= 0)
                .then_some(Reading {
                    first: r.FirstValue,
                    second: r.SecondValue,
                });
            values.push((name, value));
        }
        return Some(values);
    }
    None
}

pub(super) fn engines(handle: PDH_HCOUNTER) -> Engines {
    raw(handle)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(name, reading)| Some((Engine::parse(&name)?, reading?)))
        .collect()
}

pub(super) struct ProcessCounters {
    legacy: bool,
    ids: PDH_HCOUNTER,
    start: PDH_HCOUNTER,
    cpu: PDH_HCOUNTER,
    memory: PDH_HCOUNTER,
    io: PDH_HCOUNTER,
}

impl ProcessCounters {
    pub(super) fn attach(query: PDH_HQUERY, legacy: bool) -> Self {
        let object = if legacy { "Process" } else { "Process V2" };
        let counter = |metric| add(query, &format!("\\{object}(*)\\{metric}"));
        Self {
            legacy,
            ids: if legacy {
                counter("ID Process")
            } else {
                null_mut()
            },
            start: counter("Elapsed Time"),
            cpu: counter("% Processor Time"),
            memory: counter("Working Set - Private"),
            io: counter("IO Data Bytes/sec"),
        }
    }

    pub(super) fn io_frequency(&self) -> Option<f64> {
        let mut frequency = 0;
        (!self.io.is_null()
            && unsafe { PdhGetCounterTimeBase(self.io, &mut frequency) } == 0
            && frequency > 0)
            .then_some(frequency as f64)
    }

    pub(super) fn collect(&mut self, query: PDH_HQUERY) -> Processes {
        let mut now = self.read();
        if !self.legacy && now.is_empty() {
            // Windows 10 has no Process V2 counterset. Same-sample instance order joins
            // the classic counters to ID Process. All deltas are keyed by PID + birth time.
            for c in [self.start, self.cpu, self.memory, self.io] {
                if !c.is_null() {
                    unsafe { PdhRemoveCounter(c) };
                }
            }
            *self = Self::attach(query, true);
            if unsafe { PdhCollectQueryData(query) } == 0 {
                now = self.read();
            }
        }
        now
    }

    fn read(&self) -> Processes {
        let ids = raw(self.ids).unwrap_or_default();
        let mut processes = Processes::new();
        for (field, counter) in [self.start, self.cpu, self.memory, self.io]
            .into_iter()
            .enumerate()
        {
            let Some(items) = raw(counter) else {
                continue;
            };
            if self.legacy
                && (ids.len() != items.len()
                    || ids.iter().zip(&items).any(|(id, item)| id.0 != item.0))
            {
                continue;
            }
            for (index, (name, value)) in items.into_iter().enumerate() {
                let Some(value) = value else {
                    continue;
                };
                let (image, pid) = if self.legacy {
                    let Some(pid) = ids[index].1.and_then(|v| u32::try_from(v.first).ok()) else {
                        continue;
                    };
                    (name.as_str(), pid)
                } else {
                    let Some((image, id)) = name.rsplit_once(':') else {
                        continue;
                    };
                    let Ok(pid) = id.parse() else {
                        continue;
                    };
                    (image, pid)
                };
                if pid == 0 || image.is_empty() || image.eq_ignore_ascii_case("_Total") {
                    continue;
                }
                let process = processes.entry(pid).or_insert_with(|| Process {
                    name: image.to_owned(),
                    started: None,
                    cpu: None,
                    memory: None,
                    io: None,
                });
                match field {
                    0 => process.started = Some(value.first),
                    1 => process.cpu = Some(value),
                    2 => process.memory = Some(value),
                    _ => process.io = Some(value),
                }
            }
        }
        processes
    }
}

pub(super) fn open_query() -> Option<PDH_HQUERY> {
    let mut query = null_mut();
    (unsafe { PdhOpenQueryW(null(), 0, &mut query) } == 0).then_some(query)
}
