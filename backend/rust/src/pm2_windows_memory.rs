use super::{pdh, value};
use serde::Serialize;
use windows_sys::Win32::System::Performance::{PDH_HCOUNTER, PDH_HQUERY};

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WindowsMemory {
    kernel_nonpaged_bytes: Option<u64>,
    paged_pool_resident_bytes: Option<u64>,
    system_cache_resident_bytes: Option<u64>,
    standby_bytes: Option<u64>,
}

pub(super) struct MemoryCounters {
    nonpaged: PDH_HCOUNTER,
    paged_resident: PDH_HCOUNTER,
    cache_resident: PDH_HCOUNTER,
    standby: [PDH_HCOUNTER; 3],
}

impl MemoryCounters {
    pub(super) fn attach(query: PDH_HQUERY) -> Self {
        let counter = |name| pdh::add(query, &format!(r"\Memory\{name}"));
        Self {
            nonpaged: counter("Pool Nonpaged Bytes"),
            paged_resident: counter("Pool Paged Resident Bytes"),
            cache_resident: counter("System Cache Resident Bytes"),
            standby: [
                counter("Standby Cache Reserve Bytes"),
                counter("Standby Cache Normal Priority Bytes"),
                counter("Standby Cache Core Bytes"),
            ],
        }
    }

    pub(super) fn read(&self) -> WindowsMemory {
        let bytes = |handle| value(handle).map(|n| n as u64);
        // A missing priority list makes the total unknown, including on older guests.
        let standby_bytes = self
            .standby
            .iter()
            .try_fold(0u64, |sum, &h| sum.checked_add(bytes(h)?));
        WindowsMemory {
            kernel_nonpaged_bytes: bytes(self.nonpaged),
            paged_pool_resident_bytes: bytes(self.paged_resident),
            system_cache_resident_bytes: bytes(self.cache_resident),
            standby_bytes,
        }
    }
}
