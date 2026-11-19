use crate::{
    error::{AppError, Result},
    host_protection::{self, HostProtection},
};
use serde::Serialize;
#[path = "host_optimizer/origin.rs"]
mod origin;
use origin::{local_gui, sensitive_image, signatures, trusted_package};
use std::{
    collections::{HashMap, HashSet},
    mem::size_of,
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    path::{Path, PathBuf},
    ptr::null_mut,
    sync::{Mutex, OnceLock},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use windows_sys::Win32::{
    Foundation::{
        FILETIME, HANDLE, HWND, INVALID_HANDLE_VALUE, LPARAM, WAIT_OBJECT_0, WAIT_TIMEOUT,
    },
    Security::{
        GetTokenInformation, TokenElevation, TokenSessionId, TokenStatistics, TOKEN_ELEVATION,
        TOKEN_QUERY, TOKEN_STATISTICS,
    },
    System::{
        JobObjects::IsProcessInJob,
        Memory::{
            CreateMemoryResourceNotification, LowMemoryResourceNotification,
            QueryMemoryResourceNotification,
        },
        ProcessStatus::{K32EmptyWorkingSet, K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS},
        SystemInformation::{
            GetSystemDirectoryW, GetSystemTimeAsFileTime, GetSystemWindowsDirectoryW,
            GlobalMemoryStatusEx, MEMORYSTATUSEX,
        },
        Threading::{
            GetCurrentProcess, GetProcessIoCounters, GetProcessTimes, IsProcessCritical,
            OpenProcess, OpenProcessToken, QueryFullProcessImageNameW, WaitForSingleObject,
            IO_COUNTERS, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_QUOTA, PROCESS_SYNCHRONIZE,
        },
    },
    UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetShellWindow, GetWindow, GetWindowLongW,
        GetWindowThreadProcessId, IsIconic, IsWindowVisible, PostMessageW, GWL_EXSTYLE, GWL_STYLE,
        GW_OWNER, WM_CLOSE, WS_DISABLED, WS_EX_TOOLWINDOW,
    },
};

struct App {
    key: &'static str,
    name: &'static str,
    classic: &'static [&'static str],
    packaged: &'static [&'static str],
    family: &'static str,
}

const STATELESS_WINDOWS_TOOLS: &[App] = &[
    App {
        key: "calculator",
        name: "Calculadora",
        classic: &["calc.exe"],
        packaged: &["calculatorapp.exe", "calculator.exe"],
        family: "Microsoft.WindowsCalculator_8wekyb3d8bbwe",
    },
    App {
        key: "character-map",
        name: "Mapa de Caracteres",
        classic: &["charmap.exe"],
        packaged: &[],
        family: "",
    },
    App {
        key: "about-windows",
        name: "Sobre o Windows",
        classic: &["winver.exe"],
        packaged: &[],
        family: "",
    },
    App {
        key: "resource-monitor",
        name: "Monitor de Recursos",
        classic: &["resmon.exe"],
        packaged: &[],
        family: "",
    },
];

fn stateless_tool(name: &str) -> Option<&'static App> {
    STATELESS_WINDOWS_TOOLS.iter().find(|a| {
        a.classic
            .iter()
            .chain(a.packaged)
            .any(|n| n.eq_ignore_ascii_case(name))
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Status {
    Closed,
    Pending,
    Skipped,
    Trimmed,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Policy {
    Close,
    Trim,
    Preserve,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum Reason {
    Pm2,
    Infrastructure,
    SessionOrWindow,
    Unverified,
    Active,
    NoPressure,
    IdleUtility,
    IdleNotice,
    IdleApp,
}

#[derive(Serialize)]
struct Assessment {
    pid: u32,
    name: String,
    started: Option<String>,
    policy: Policy,
    reason: Reason,
}
impl Assessment {
    fn decide(&mut self, reason: Reason) {
        self.policy = match reason {
            Reason::IdleUtility | Reason::IdleNotice => Policy::Close,
            Reason::IdleApp => Policy::Trim,
            _ => Policy::Preserve,
        };
        self.reason = reason;
    }
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Preserved {
    pm2: usize,
    infrastructure: usize,
    session_or_window: usize,
    unverified: usize,
    active: usize,
    no_pressure: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Analysis {
    sampled_at: u64,
    scanned_count: usize,
    memory_pressure: Option<bool>,
    processes: Vec<Assessment>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Outcome {
    key: String,
    name: String,
    pid: u32,
    status: Status,
    reduced_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloseReport {
    results: Vec<Outcome>,
    closed_count: usize,
    closed_memory_bytes: u64,
    protected_count: usize,
    available_before_bytes: Option<u64>,
    available_after_bytes: Option<u64>,
    scanned_count: usize,
    eligible_count: usize,
    trimmed_count: usize,
    trimmed_memory_bytes: u64,
    memory_pressure: Option<bool>,
    preserved: Preserved,
}
struct Item {
    pid: u32,
    shell_pid: u32,
    started: u64,
    image: String,
    memory_bytes: u64,
    handle: OwnedHandle,
    window: isize,
    activity: Activity,
    launcher_paths: Vec<String>,
    trusted_store: bool,
    stateless: Option<&'static App>,
    policy: Policy,
    notice: bool,
}
struct Scan {
    analysis: Analysis,
    items: Vec<Item>,
}
fn unavailable() -> AppError {
    AppError::new(
        "optimizer",
        "O Windows não conseguiu verificar os aplicativos desta sessão.",
    )
}

fn owned(handle: HANDLE) -> Option<OwnedHandle> {
    if handle.is_null() || handle == INVALID_HANDLE_VALUE {
        return None;
    }
    Some(unsafe { OwnedHandle::from_raw_handle(handle) })
}

fn open(pid: u32) -> Option<OwnedHandle> {
    owned(unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
            0,
            pid,
        )
    })
}

fn image(handle: HANDLE) -> Option<String> {
    let mut path = vec![0u16; 32768];
    let mut size = path.len() as u32;
    (unsafe { QueryFullProcessImageNameW(handle, 0, path.as_mut_ptr(), &mut size) } != 0)
        .then(|| String::from_utf16_lossy(&path[..size as usize]))
}

fn creation(handle: HANDLE) -> Option<u64> {
    let mut start = FILETIME::default();
    let mut exit = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    (unsafe { GetProcessTimes(handle, &mut start, &mut exit, &mut kernel, &mut user) } != 0)
        .then_some((u64::from(start.dwHighDateTime) << 32) | u64::from(start.dwLowDateTime))
}

#[derive(PartialEq)]
struct Logon {
    session: u32,
    high: i32,
    low: u32,
}

fn logon(process: HANDLE) -> Option<Logon> {
    let mut token = null_mut();
    if unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) } == 0 {
        return None;
    }
    let token_handle = owned(token)?;
    let mut info = TOKEN_STATISTICS::default();
    let mut session = 0u32;
    let mut length = 0;
    let token = token_handle.as_raw_handle();
    unsafe {
        if GetTokenInformation(
            token,
            TokenStatistics,
            (&mut info as *mut TOKEN_STATISTICS).cast(),
            size_of::<TOKEN_STATISTICS>() as u32,
            &mut length,
        ) == 0
            || GetTokenInformation(
                token,
                TokenSessionId,
                (&mut session as *mut u32).cast(),
                4,
                &mut length,
            ) == 0
            || session == 0
        {
            return None;
        }
    }
    Some(Logon {
        session,
        high: info.AuthenticationId.HighPart,
        low: info.AuthenticationId.LowPart,
    })
}

fn directory(api: unsafe extern "system" fn(*mut u16, u32) -> u32) -> Option<PathBuf> {
    let mut wide = vec![0u16; 32768];
    let length = unsafe { api(wide.as_mut_ptr(), wide.len() as u32) } as usize;
    (length > 0 && length < wide.len())
        .then(|| PathBuf::from(String::from_utf16_lossy(&wide[..length])))
}

fn window_pid(window: HWND) -> u32 {
    let mut pid = 0;
    if !window.is_null() {
        unsafe { GetWindowThreadProcessId(window, &mut pid) };
    }
    pid
}

// More than one visible top-level window (including a Save dialog) is ambiguous.
fn desktop_windows() -> Option<HashMap<u32, Option<isize>>> {
    unsafe extern "system" fn visit(window: HWND, param: LPARAM) -> i32 {
        if IsWindowVisible(window) == 0 {
            return 1;
        }
        let pid = window_pid(window);
        let main = IsIconic(window) != 0
            && GetWindow(window, GW_OWNER).is_null()
            && GetWindowLongW(window, GWL_STYLE) as u32 & WS_DISABLED == 0
            && GetWindowLongW(window, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW == 0;
        let entries = &mut *(param as *mut HashMap<u32, Option<isize>>);
        entries
            .entry(pid)
            .and_modify(|v| *v = None)
            .or_insert(main.then_some(window as isize));
        1
    }
    let mut entries = HashMap::new();
    let ok = unsafe { EnumWindows(Some(visit), &mut entries as *mut _ as LPARAM) };
    (ok != 0).then_some(entries)
}

fn working_set(handle: HANDLE) -> Option<u64> {
    let size = size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
    let mut counters = PROCESS_MEMORY_COUNTERS {
        cb: size,
        ..Default::default()
    };
    (unsafe { K32GetProcessMemoryInfo(handle, &mut counters, size) } != 0)
        .then_some(counters.WorkingSetSize as u64)
}

fn available() -> Option<u64> {
    let mut value = MEMORYSTATUSEX {
        dwLength: size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    (unsafe { GlobalMemoryStatusEx(&mut value) } != 0).then_some(value.ullAvailPhys)
}

fn low_memory() -> Option<bool> {
    let h = owned(unsafe { CreateMemoryResourceNotification(LowMemoryResourceNotification) })?;
    let mut signaled = 0;
    (unsafe { QueryMemoryResourceNotification(h.as_raw_handle(), &mut signaled) } != 0)
        .then_some(signaled != 0)
}

fn normal_desktop_process(raw: HANDLE) -> bool {
    let mut critical = 1;
    let mut job = 1;
    let mut token = null_mut();
    if unsafe { IsProcessCritical(raw, &mut critical) } == 0
        || critical != 0
        || unsafe { IsProcessInJob(raw, null_mut(), &mut job) } == 0
        || job != 0
        || unsafe { OpenProcessToken(raw, TOKEN_QUERY, &mut token) } == 0
    {
        return false;
    }
    let Some(token) = owned(token) else {
        return false;
    };
    let mut elevation = TOKEN_ELEVATION::default();
    let mut length = 0;
    unsafe {
        GetTokenInformation(
            token.as_raw_handle(),
            TokenElevation,
            (&mut elevation as *mut TOKEN_ELEVATION).cast(),
            size_of::<TOKEN_ELEVATION>() as u32,
            &mut length,
        ) != 0
            && elevation.TokenIsElevated == 0
    }
}

#[derive(Clone, Copy)]
struct Activity {
    cpu: u64,
    read: u64,
    write: u64,
    other: u64,
    faults: u32,
}
fn ticks(time: FILETIME) -> u64 {
    (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime)
}
fn activity(raw: HANDLE) -> Option<Activity> {
    let (mut started, mut end, mut kernel, mut user) = (
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
    );
    let mut io = IO_COUNTERS::default();
    let size = size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
    let mut memory = PROCESS_MEMORY_COUNTERS {
        cb: size,
        ..Default::default()
    };
    if unsafe { GetProcessTimes(raw, &mut started, &mut end, &mut kernel, &mut user) } == 0
        || unsafe { GetProcessIoCounters(raw, &mut io) } == 0
        || unsafe { K32GetProcessMemoryInfo(raw, &mut memory, size) } == 0
    {
        return None;
    }
    Some(Activity {
        cpu: ticks(kernel).checked_add(ticks(user))?,
        read: io.ReadTransferCount,
        write: io.WriteTransferCount,
        other: io.OtherTransferCount,
        faults: memory.PageFaultCount,
    })
}
impl Activity {
    fn quiet_since(self, prior: Self) -> bool {
        self.cpu.checked_sub(prior.cpu).is_some_and(|x|x<=100_000) // 10 ms of CPU
            && self.read==prior.read && self.write==prior.write && self.other==prior.other
            && self.faults.checked_sub(prior.faults).is_some_and(|n|n<=4)
    }
}

struct Desktop {
    me: Logon,
    shell: OwnedHandle,
    shell_pid: u32,
    shell_started: u64,
    explorer: String,
    system: PathBuf,
    windows: HashMap<u32, Option<isize>>,
    active: u32,
}
impl Desktop {
    fn read() -> Option<Self> {
        let system = directory(GetSystemDirectoryW)?;
        let explorer = directory(GetSystemWindowsDirectoryW)?
            .join("explorer.exe")
            .to_string_lossy()
            .into_owned();
        let shell_pid = window_pid(unsafe { GetShellWindow() });
        let shell = open(shell_pid)?;
        let me = logon(unsafe { GetCurrentProcess() })?;
        let shell_started = creation(shell.as_raw_handle())?;
        if logon(shell.as_raw_handle()).as_ref() != Some(&me)
            || !image(shell.as_raw_handle())?.eq_ignore_ascii_case(&explorer)
        {
            return None;
        }
        Some(Self {
            me,
            shell,
            shell_pid,
            shell_started,
            explorer,
            system,
            windows: desktop_windows()?,
            active: window_pid(unsafe { GetForegroundWindow() }),
        })
    }
    fn launchers(
        &self,
        pid: u32,
        mut start: u64,
        parents: &HashMap<u32, u32>,
    ) -> Option<Vec<String>> {
        let mut current = pid;
        let mut paths = Vec::new();
        for _ in 0..10 {
            current = *parents.get(&current)?;
            if current == self.shell_pid {
                return (self.shell_started < start
                    && unsafe { WaitForSingleObject(self.shell.as_raw_handle(), 0) }
                        == WAIT_TIMEOUT)
                    .then_some(paths);
            }
            let parent = open(current)?;
            let raw = parent.as_raw_handle();
            let born = creation(raw)?;
            let path = image(raw)?;
            if born >= start
                || logon(raw).as_ref() != Some(&self.me)
                || !normal_desktop_process(raw)
                || sensitive_image(&path)
                || !local_gui(Path::new(&path))
            {
                return None;
            }
            paths.push(path);
            start = born;
        }
        None
    }
}

fn candidate(
    pid: u32,
    desktop: &Desktop,
    guards: &HostProtection,
) -> std::result::Result<Item, Reason> {
    let window = desktop
        .windows
        .get(&pid)
        .copied()
        .flatten()
        .ok_or(Reason::SessionOrWindow)?;
    if desktop.active == pid || desktop.active == 0 || pid == std::process::id() {
        return Err(Reason::SessionOrWindow);
    }
    let handle = open(pid).ok_or(Reason::Unverified)?;
    let raw = handle.as_raw_handle();
    if logon(raw).as_ref() != Some(&desktop.me) {
        return Err(Reason::SessionOrWindow);
    }
    if !normal_desktop_process(raw) {
        return Err(Reason::Infrastructure);
    }
    let started = creation(raw).ok_or(Reason::Unverified)?;
    let path = image(raw).ok_or(Reason::Unverified)?;
    if sensitive_image(&path) {
        return Err(Reason::Infrastructure);
    }
    if !local_gui(Path::new(&path)) {
        return Err(Reason::Unverified);
    }
    let launchers = desktop
        .launchers(pid, started, &guards.parents)
        .ok_or(Reason::Unverified)?;
    let file = Path::new(&path);
    let name = file
        .file_name()
        .and_then(|f| f.to_str())
        .ok_or(Reason::Unverified)?;
    let family = trusted_package(raw, file);
    let stateless = stateless_tool(name).filter(|tool| {
        let classic = tool.classic.iter().any(|n| n.eq_ignore_ascii_case(name))
            && path.eq_ignore_ascii_case(&desktop.system.join(name).to_string_lossy());
        let package = tool.packaged.iter().any(|n| n.eq_ignore_ascii_case(name))
            && family
                .as_ref()
                .is_some_and(|v| v.eq_ignore_ascii_case(tool.family));
        classic || package
    });
    let memory_bytes = working_set(raw).ok_or(Reason::Unverified)?;
    let baseline = activity(raw).ok_or(Reason::Unverified)?;
    Ok(Item {
        pid,
        shell_pid: desktop.shell_pid,
        started,
        image: path,
        memory_bytes,
        handle,
        window,
        activity: baseline,
        launcher_paths: launchers,
        trusted_store: family.is_some(),
        stateless,
        notice: false,
        policy: Policy::Preserve,
    })
}

const MIN_TRIM_BYTES: u64 = 16 * 1024 * 1024;
type Cooldowns = HashMap<(u32, u64), Instant>;
static TRIMS: OnceLock<Mutex<Cooldowns>> = OnceLock::new();
fn recent_trim(item: &Item) -> bool {
    TRIMS.get().is_some_and(|m| {
        m.lock()
            .map(|entries| {
                entries
                    .get(&(item.pid, item.started))
                    .is_some_and(|t| t.elapsed() < Duration::from_secs(600))
            })
            .unwrap_or(true)
    })
}

fn same_window(item: &Item, active: u32, windows: &HashMap<u32, Option<isize>>) -> bool {
    active != 0
        && active != item.pid
        && windows.get(&item.pid) == Some(&Some(item.window))
        && window_pid(item.window as HWND) == item.pid
        && unsafe { IsIconic(item.window as HWND) } != 0
        && unsafe { WaitForSingleObject(item.handle.as_raw_handle(), 0) } == WAIT_TIMEOUT
}
fn same_instance(item: &Item) -> bool {
    let raw = item.handle.as_raw_handle();
    creation(raw) == Some(item.started)
        && image(raw).is_some_and(|p| p.eq_ignore_ascii_case(&item.image))
}
fn just_started(birth: u64) -> bool {
    let mut now = FILETIME::default();
    unsafe { GetSystemTimeAsFileTime(&mut now) };
    ticks(now)
        .checked_sub(birth)
        .is_none_or(|elapsed| elapsed < 600_000_000)
}

fn still_background(item: &Item) -> bool {
    let active = window_pid(unsafe { GetForegroundWindow() });
    active != 0
        && active != item.pid
        && window_pid(item.window as HWND) == item.pid
        && unsafe { IsIconic(item.window as HWND) } != 0
}
fn utc_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn idle_policy(
    disposable: bool,
    notice: bool,
    bytes: u64,
    recently_trimmed: bool,
    pressure: Option<bool>,
) -> Reason {
    if disposable {
        return Reason::IdleUtility;
    }
    if notice {
        return Reason::IdleNotice;
    }
    if bytes < MIN_TRIM_BYTES || recently_trimmed {
        return Reason::Active;
    }
    match pressure {
        Some(true) => Reason::IdleApp,
        Some(false) => Reason::NoPressure,
        None => Reason::Unverified,
    }
}

fn scan(pm2: &HashSet<u32>, guards: &HostProtection, pressure: fn() -> Option<bool>) -> Scan {
    let desktop = Desktop::read();
    let mut processes = Vec::with_capacity(guards.parents.len());
    let mut pending = Vec::new();
    let mut paths = HashSet::new();
    let mut ids: Vec<_> = guards.parents.keys().copied().collect();
    ids.sort_unstable();
    for pid in ids {
        let mut row = Assessment {
            pid,
            name: guards
                .names
                .get(&pid)
                .filter(|s| !s.is_empty())
                .cloned()
                .unwrap_or_else(|| format!("PID {pid}")),
            started: None,
            policy: Policy::Preserve,
            reason: Reason::Unverified,
        };
        let item = if pm2.contains(&pid) {
            Err(Reason::Pm2)
        } else if guards.is_protected(pid) {
            Err(Reason::Infrastructure)
        } else if let Some(d) = desktop.as_ref() {
            candidate(pid, d, guards)
        } else {
            Err(Reason::SessionOrWindow)
        };
        match item {
            Ok(i) => {
                row.started = Some(i.started.to_string());
                paths.extend(i.launcher_paths.iter().cloned());
                if !i.trusted_store {
                    paths.insert(i.image.clone());
                }
                pending.push((processes.len(), i));
            }
            Err(reason) => row.decide(reason),
        }
        if row.started.is_none() && pid != 0 {
            row.started = owned(unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) })
                .and_then(|proc| creation(proc.as_raw_handle()))
                .map(|t| t.to_string());
        }
        processes.push(row);
    }
    let mut items = Vec::new();
    let mut memory_pressure = pressure();
    if let Some(d) = desktop.as_ref().filter(|_| !pending.is_empty()) {
        paths.insert(d.explorer.clone());
        let start = Instant::now();
        let verified = signatures(&d.system, &paths).unwrap_or_default();
        // Two snapshots share a quiet observation interval across all candidates.
        thread::sleep(Duration::from_millis(1300).saturating_sub(start.elapsed()));
        memory_pressure = pressure();
        let windows = desktop_windows().unwrap_or_default();
        let active = window_pid(unsafe { GetForegroundWindow() });
        let shell_ok = verified.get(&d.explorer) == Some(&true)
            && window_pid(unsafe { GetShellWindow() }) == d.shell_pid;
        for (index, mut i) in pending {
            let row = &mut processes[index];
            let proof = i.trusted_store || verified.contains_key(&i.image);
            if !shell_ok || !proof || !i.launcher_paths.iter().all(|p| verified.contains_key(p)) {
                row.decide(Reason::Unverified);
                continue;
            }
            if !same_instance(&i) || !same_window(&i, active, &windows) {
                row.decide(Reason::SessionOrWindow);
                continue;
            }
            let Some(now) = activity(i.handle.as_raw_handle()) else {
                row.decide(Reason::Unverified);
                continue;
            };
            if just_started(i.started) || !now.quiet_since(i.activity) {
                row.decide(Reason::Active);
                continue;
            }
            i.activity = now;
            let close =
                i.stateless.is_some() && (i.trusted_store || verified.get(&i.image) == Some(&true));
            i.notice = !close && crate::read_only_dialog::is_informational(i.window as HWND);
            let reason = idle_policy(
                close,
                i.notice,
                i.memory_bytes,
                recent_trim(&i),
                memory_pressure,
            );
            row.decide(reason);
            i.policy = row.policy;
            if i.policy != Policy::Preserve {
                items.push(i)
            }
        }
    }
    Scan {
        analysis: Analysis {
            sampled_at: utc_ms(),
            scanned_count: processes.len(),
            memory_pressure,
            processes,
        },
        items,
    }
}

fn trim(item: &Item) -> Option<u64> {
    // Only acquire the quota right for an already qualified PID; the earlier
    // handle remains live so the OS cannot recycle its PID during this action.
    let handle = owned(unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_QUOTA | PROCESS_SYNCHRONIZE,
            0,
            item.pid,
        )
    })?;
    let raw = handle.as_raw_handle();
    if creation(raw) != Some(item.started) || !normal_desktop_process(raw) {
        return None;
    }
    let before = working_set(raw)?;
    if before < MIN_TRIM_BYTES || !still_background(item) || unsafe { K32EmptyWorkingSet(raw) } == 0
    {
        return None;
    }
    if let Ok(mut times) = TRIMS.get_or_init(|| Mutex::new(HashMap::new())).lock() {
        times.retain(|_, t| t.elapsed() < Duration::from_secs(600));
        times.insert((item.pid, item.started), Instant::now());
    }
    let after = working_set(raw)?;
    if unsafe { WaitForSingleObject(raw, 0) } != WAIT_TIMEOUT {
        return None;
    }
    Some(before.saturating_sub(after)).filter(|v| *v > 0)
}
fn preserved(rows: &[Assessment]) -> Preserved {
    let mut p = Preserved::default();
    for row in rows {
        match row.reason {
            Reason::Pm2 => p.pm2 += 1,
            Reason::Infrastructure => p.infrastructure += 1,
            Reason::SessionOrWindow => p.session_or_window += 1,
            Reason::Unverified => p.unverified += 1,
            Reason::Active => p.active += 1,
            Reason::NoPressure => p.no_pressure += 1,
            _ => {}
        }
    }
    p
}
fn apply(
    mut scan: Scan,
    guard: &HostProtection,
    pm2_count: usize,
    before: Option<u64>,
    pressure: fn() -> Option<bool>,
) -> CloseReport {
    let mut report = CloseReport {
        results: vec![],
        closed_count: 0,
        closed_memory_bytes: 0,
        protected_count: pm2_count,
        available_before_bytes: before,
        available_after_bytes: None,
        scanned_count: scan.analysis.scanned_count,
        eligible_count: scan.items.len(),
        trimmed_count: 0,
        trimmed_memory_bytes: 0,
        memory_pressure: scan.analysis.memory_pressure,
        preserved: preserved(&scan.analysis.processes),
    };
    let mut posted = Vec::new();
    scan.items.sort_by_key(|i| {
        (
            i.policy != Policy::Close,
            std::cmp::Reverse(i.memory_bytes),
            i.pid,
        )
    });
    for item in scan.items {
        let index = report.results.len();
        let name = Path::new(&item.image)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let (key, name) = item.stateless.map_or_else(
            || (name.to_lowercase(), name),
            |s| (s.key.into(), s.name.into()),
        );
        report.results.push(Outcome {
            key,
            name,
            pid: item.pid,
            status: Status::Skipped,
            reduced_bytes: 0,
        });
        if guard.is_protected(item.pid)
            || !same_instance(&item)
            || !normal_desktop_process(item.handle.as_raw_handle())
        {
            continue;
        }
        let Some(desktop) = Desktop::read() else {
            continue;
        };
        if desktop.shell_pid != item.shell_pid
            || logon(item.handle.as_raw_handle()).as_ref() != Some(&desktop.me)
            || desktop
                .launchers(item.pid, item.started, &guard.parents)
                .as_ref()
                != Some(&item.launcher_paths)
            || !same_window(&item, desktop.active, &desktop.windows)
        {
            continue;
        }
        if !activity(item.handle.as_raw_handle()).is_some_and(|a| a.quiet_since(item.activity)) {
            continue;
        }
        match item.policy {
            Policy::Close => {
                if item.notice && !crate::read_only_dialog::is_informational(item.window as HWND) {
                    continue;
                }
                if still_background(&item)
                    && unsafe { PostMessageW(item.window as HWND, WM_CLOSE, 0, 0) } != 0
                {
                    posted.push((index, item));
                }
            }
            Policy::Trim if !recent_trim(&item) && pressure() == Some(true) => {
                if let Some(freed) = trim(&item) {
                    report.results[index].status = Status::Trimmed;
                    report.results[index].reduced_bytes = freed;
                    report.trimmed_memory_bytes += freed;
                    report.trimmed_count += 1;
                }
            }
            _ => {}
        }
    }
    let deadline = Instant::now() + Duration::from_millis(1500);
    while !posted.is_empty() {
        posted.retain(|(index, item)| {
            let closed =
                unsafe { WaitForSingleObject(item.handle.as_raw_handle(), 0) } == WAIT_OBJECT_0;
            report.results[*index].status = if closed {
                Status::Closed
            } else {
                Status::Pending
            };
            if closed {
                report.closed_count += 1;
                report.closed_memory_bytes += item.memory_bytes;
            }
            !closed
        });
        if posted.is_empty() || Instant::now() >= deadline {
            break;
        }
        thread::sleep(Duration::from_millis(50));
    }
    report.available_after_bytes = available();
    report
}

async fn inspect() -> Result<Scan> {
    let pm2 = crate::pm2::optimizer_protection().await?;
    tokio::task::spawn_blocking(move || {
        let guards = host_protection::snapshot(pm2.clone())?;
        Ok(scan(&pm2, &guards, low_memory))
    })
    .await
    .map_err(|_| unavailable())?
}

#[tauri::command]
pub(crate) async fn optimizer_analyze() -> Result<Analysis> {
    Ok(inspect().await?.analysis)
}

#[tauri::command]
pub(crate) async fn optimizer_close() -> Result<CloseReport> {
    static CLOSE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = CLOSE
        .try_lock()
        .map_err(|_| AppError::new("optimizer", "Já há uma otimização em andamento."))?;
    let before = available();
    let planned = inspect().await?;
    let pm2 = crate::pm2::optimizer_protection().await?;
    tokio::task::spawn_blocking(move || {
        let count = pm2.len();
        let protection = host_protection::snapshot(pm2)?;
        Ok(apply(planned, &protection, count, before, low_memory))
    })
    .await
    .map_err(|_| unavailable())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_or_cpu_activity_blocks_a_memory_trim() {
        let idle = Activity {
            cpu: 100,
            read: 25,
            write: 1,
            other: 2,
            faults: 0,
        };
        assert!(idle.quiet_since(idle));
        assert!(!Activity { read: 26, ..idle }.quiet_since(idle));
        assert!(!Activity {
            cpu: 200_000,
            ..idle
        }
        .quiet_since(idle));
        assert!(!Activity { faults: 9, ..idle }.quiet_since(idle));
    }
    #[test]
    fn documents_and_developer_tools_are_never_classed_as_disposable_by_name() {
        assert_eq!(stateless_tool("CHARMAP.EXE").unwrap().key, "character-map");
        for name in [
            "SumatraPDF.exe",
            "notepad.exe",
            "powershell.exe",
            "node.exe",
            "postgres.exe",
        ] {
            assert!(stateless_tool(name).is_none());
        }
    }
    #[test]
    fn unknown_sources_busy_apps_and_protected_processes_have_distinct_results() {
        let mut rows = Vec::new();
        for (i, r) in [
            Reason::Pm2,
            Reason::Infrastructure,
            Reason::Active,
            Reason::SessionOrWindow,
            Reason::Unverified,
            Reason::NoPressure,
            Reason::IdleApp,
            Reason::IdleUtility,
        ]
        .into_iter()
        .enumerate()
        {
            let mut row = Assessment {
                pid: i as u32,
                name: String::new(),
                started: None,
                policy: Policy::Preserve,
                reason: r,
            };
            row.decide(r);
            rows.push(row)
        }
        let p = preserved(&rows);
        assert_eq!(
            p.pm2
                + p.infrastructure
                + p.active
                + p.session_or_window
                + p.unverified
                + p.no_pressure,
            6
        );
        assert_eq!(rows[6].policy, Policy::Trim);
        assert_eq!(rows[7].policy, Policy::Close);
    }
    #[test]
    fn any_eligible_publisher_can_reduce_working_set_without_closing_a_document() {
        assert_eq!(
            idle_policy(false, false, 64 << 20, false, Some(true)),
            Reason::IdleApp
        );
        assert_eq!(
            idle_policy(false, false, 64 << 20, false, Some(false)),
            Reason::NoPressure
        );
        assert_eq!(
            idle_policy(false, false, 64 << 20, false, None),
            Reason::Unverified
        );
        assert_eq!(
            idle_policy(false, false, 64 << 20, true, Some(true)),
            Reason::Active
        );
        assert_eq!(
            idle_policy(false, true, 32 << 20, false, None),
            Reason::IdleNotice
        );
        assert_eq!(
            idle_policy(true, false, 32 << 20, false, Some(false)),
            Reason::IdleUtility
        );
    }
    #[test]
    fn never_uses_a_foreground_window_or_an_unrelated_process_lifetime() {
        let pid = std::process::id();
        let handle = open(pid).unwrap();
        let raw = handle.as_raw_handle();
        let mut item = Item {
            pid,
            shell_pid: 0,
            started: creation(raw).unwrap(),
            image: image(raw).unwrap(),
            memory_bytes: 16 << 20,
            activity: activity(raw).unwrap(),
            handle,
            window: 0,
            launcher_paths: vec![],
            trusted_store: false,
            stateless: None,
            notice: false,
            policy: Policy::Preserve,
        };
        assert!(same_instance(&item));
        assert!(!same_window(&item, pid, &HashMap::from([(pid, Some(0))])));
        item.started += 1;
        assert!(!same_instance(&item));
        item.started -= 1;
        item.image.push('x');
        assert!(!same_instance(&item));
    }
}
