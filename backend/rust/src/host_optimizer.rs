use crate::error::{AppError, Result};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    io::Write,
    mem::size_of,
    os::windows::{
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
        process::CommandExt,
    },
    path::{Path, PathBuf},
    process::{Command, Stdio},
    ptr::null_mut,
    thread,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::{
        FILETIME, HANDLE, HWND, INVALID_HANDLE_VALUE, LPARAM, WAIT_OBJECT_0, WAIT_TIMEOUT,
    },
    Security::{
        GetTokenInformation, TokenSessionId, TokenStatistics, TOKEN_QUERY, TOKEN_STATISTICS,
    },
    Storage::Packaging::Appx::{
        GetPackageFamilyName, GetPackageFullName, GetPackagePathByFullName, GetStagedPackageOrigin,
        PackageOrigin_Inbox, PackageOrigin_Store,
    },
    System::{
        ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS},
        SystemInformation::{
            GetSystemDirectoryW, GetSystemWindowsDirectoryW, GlobalMemoryStatusEx, MEMORYSTATUSEX,
        },
        Threading::{
            GetCurrentProcess, GetProcessTimes, OpenProcess, OpenProcessToken,
            QueryFullProcessImageNameW, WaitForSingleObject, CREATE_NO_WINDOW,
            PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
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

const CATALOG: &[App] = &[
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

fn catalog_app(name: &str) -> Option<&'static App> {
    CATALOG.iter().find(|a| {
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
}

#[derive(Serialize)]
struct Outcome {
    key: &'static str,
    name: &'static str,
    pid: u32,
    status: Status,
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
}

struct Item {
    app: &'static App,
    pid: u32,
    shell_pid: u32,
    started: u64,
    image: String,
    memory_bytes: u64,
    handle: OwnedHandle,
    window: isize,
    classic: bool,
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

fn package_string(api: impl FnOnce(&mut u32, *mut u16) -> u32) -> Option<String> {
    let mut text = vec![0u16; 32768];
    let mut count = text.len() as u32;
    (api(&mut count, text.as_mut_ptr()) == 0 && count > 1 && count as usize <= text.len())
        .then(|| String::from_utf16_lossy(&text[..count as usize - 1]))
}

fn trusted_package(handle: HANDLE, path: &Path, family: &str) -> bool {
    let check = || -> Option<bool> {
        let actual = package_string(|n, p| unsafe { GetPackageFamilyName(handle, n, p) })?;
        if !actual.eq_ignore_ascii_case(family) {
            return None;
        }
        let name = package_string(|n, p| unsafe { GetPackageFullName(handle, n, p) })?;
        let wide: Vec<_> = name.encode_utf16().chain(Some(0)).collect();
        let mut origin = 0;
        if unsafe { GetStagedPackageOrigin(wide.as_ptr(), &mut origin) } != 0
            || (origin != PackageOrigin_Inbox && origin != PackageOrigin_Store)
        {
            return None;
        }
        let install =
            package_string(|n, p| unsafe { GetPackagePathByFullName(wide.as_ptr(), n, p) })?;
        let install = PathBuf::from(install.to_lowercase());
        let in_windows_apps = install
            .parent()?
            .file_name()?
            .eq_ignore_ascii_case("WindowsApps");
        Some(
            in_windows_apps
                && Path::new(&path.to_string_lossy().to_lowercase()).starts_with(install),
        )
    };
    check() == Some(true)
}

// Authenticode also checks catalog signatures of Windows system files. Input paths
// travel as JSON on stdin; no executable path or UI value is evaluated as script.
fn signatures(system: &Path, paths: &HashSet<String>) -> Option<HashSet<String>> {
    const VERIFY: &str = r#"
$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = [Console]::InputEncoding
$valid = @(foreach ($p in (ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd()))) {
  $s = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $p
  if ($s.Status -eq 'Valid' -and $s.SignerCertificate -and
      $s.SignerCertificate.GetNameInfo('SimpleName',$false) -in @('Microsoft Windows','Microsoft Windows Publisher','Microsoft Corporation')) { $p }
})
[Console]::Write((ConvertTo-Json -Compress -InputObject $valid))
"#;
    let mut child = Command::new(system.join(r"WindowsPowerShell\v1.0\powershell.exe"))
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            VERIFY,
        ])
        .env(
            "PSModulePath",
            system.join(r"WindowsPowerShell\v1.0\Modules"),
        )
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let payload = serde_json::to_vec(paths).ok()?;
    child.stdin.take()?.write_all(&payload).ok()?;
    let until = Instant::now() + Duration::from_secs(12);
    loop {
        if child.try_wait().ok()?.is_some() {
            break;
        }
        if Instant::now() >= until {
            let _ = child.kill(); // Only the private certificate-checking helper.
            let _ = child.wait();
            return None;
        }
        thread::sleep(Duration::from_millis(30));
    }
    let output = child.wait_with_output().ok()?;
    if !output.status.success() {
        return None;
    }
    serde_json::from_slice(&output.stdout).ok()
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

fn scan() -> Result<Vec<Item>> {
    let windows = directory(GetSystemWindowsDirectoryW).ok_or_else(unavailable)?;
    let system = directory(GetSystemDirectoryW).ok_or_else(unavailable)?;
    let explorer = windows.join("explorer.exe").to_string_lossy().into_owned();
    let shell_pid = window_pid(unsafe { GetShellWindow() });
    if shell_pid == 0 {
        return Ok(vec![]);
    }
    let shell = open(shell_pid).ok_or_else(unavailable)?;
    let shell_handle = shell.as_raw_handle();
    let me = logon(unsafe { GetCurrentProcess() }).ok_or_else(unavailable)?;
    if logon(shell_handle).as_ref() != Some(&me)
        || !image(shell_handle).is_some_and(|p| p.eq_ignore_ascii_case(&explorer))
    {
        return Ok(vec![]);
    }
    let shell_created = creation(shell_handle).ok_or_else(unavailable)?;
    let parents = crate::pm2_ports::parents().ok_or_else(unavailable)?;
    let foreground = window_pid(unsafe { GetForegroundWindow() });
    if foreground == 0 {
        return Ok(vec![]);
    }
    let mut items = Vec::new();
    let mut paths = HashSet::from([explorer.clone()]);
    for (pid, window) in desktop_windows().ok_or_else(unavailable)? {
        let Some(window) = window else { continue };
        if pid == 0
            || pid == foreground
            || pid == std::process::id()
            || parents.get(&pid) != Some(&shell_pid)
        {
            continue;
        }
        let Some(handle) = open(pid) else { continue };
        let raw = handle.as_raw_handle();
        let Some(path) = image(raw) else { continue };
        let file = Path::new(&path);
        let Some(name) = file.file_name().and_then(|v| v.to_str()) else {
            continue;
        };
        let Some(app) = catalog_app(name) else {
            continue;
        };
        let Some(started) = creation(raw) else {
            continue;
        };
        if started <= shell_created || logon(raw).as_ref() != Some(&me) {
            continue;
        }
        let classic = app.classic.iter().any(|n| n.eq_ignore_ascii_case(name))
            && path.eq_ignore_ascii_case(&system.join(name).to_string_lossy());
        if !classic
            && !(app.packaged.iter().any(|n| n.eq_ignore_ascii_case(name))
                && trusted_package(raw, file, app.family))
        {
            continue;
        }
        let Some(memory_bytes) = working_set(raw) else {
            continue;
        };
        if classic {
            paths.insert(path.clone());
        }
        items.push(Item {
            app,
            pid,
            shell_pid,
            started,
            image: path,
            memory_bytes,
            handle,
            window,
            classic,
        });
    }
    if !items.is_empty() {
        let valid = signatures(&system, &paths).ok_or_else(unavailable)?;
        let shell_ok =
            valid.contains(&explorer) && window_pid(unsafe { GetShellWindow() }) == shell_pid;
        let current_windows = desktop_windows().ok_or_else(unavailable)?;
        let active = window_pid(unsafe { GetForegroundWindow() });
        items.retain(|i| {
            shell_ok
                && eligible_window(i, active, &current_windows)
                && (!i.classic || valid.contains(&i.image))
        });
    }
    items.sort_by_key(|i| (i.app.name, i.pid));
    Ok(items)
}

fn eligible_window(item: &Item, active: u32, windows: &HashMap<u32, Option<isize>>) -> bool {
    active != 0
        && active != item.pid
        && windows.get(&item.pid) == Some(&Some(item.window))
        && window_pid(item.window as HWND) == item.pid
        && unsafe { WaitForSingleObject(item.handle.as_raw_handle(), 0) } == WAIT_TIMEOUT
}

fn same_instance(item: &Item) -> bool {
    let raw = item.handle.as_raw_handle();
    creation(raw) == Some(item.started)
        && image(raw).is_some_and(|path| path.eq_ignore_ascii_case(&item.image))
}

fn available() -> Option<u64> {
    let mut mem = MEMORYSTATUSEX {
        dwLength: size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    (unsafe { GlobalMemoryStatusEx(&mut mem) } != 0).then_some(mem.ullAvailPhys)
}

fn request_close(
    items: Vec<Item>,
    protected: &HashSet<u32>,
    available_before_bytes: Option<u64>,
) -> CloseReport {
    let mut results = Vec::new();
    let mut posted = Vec::new();
    let parents = crate::pm2_ports::parents();
    for item in items {
        let index = results.len();
        results.push(Outcome {
            key: item.app.key,
            name: item.app.name,
            pid: item.pid,
            status: Status::Skipped,
        });
        // The retained process handle pins its identity across both snapshots.
        // Reject a shell restart or an incomplete ancestry snapshot.
        if protected.contains(&item.pid)
            || window_pid(unsafe { GetShellWindow() }) != item.shell_pid
            || parents.as_ref().and_then(|p| p.get(&item.pid)) != Some(&item.shell_pid)
        {
            continue;
        }
        let Some(windows) = desktop_windows() else {
            continue;
        };
        let active = window_pid(unsafe { GetForegroundWindow() });
        if same_instance(&item)
            && eligible_window(&item, active, &windows)
            && unsafe { IsIconic(item.window as HWND) } != 0
            && unsafe { PostMessageW(item.window as HWND, WM_CLOSE, 0, 0) } != 0
        {
            posted.push((index, item));
        }
    }
    let deadline = Instant::now() + Duration::from_millis(1500);
    let mut closed_count = 0;
    let mut closed_memory_bytes = 0;
    while !posted.is_empty() {
        posted.retain(|(index, item)| {
            let closed =
                unsafe { WaitForSingleObject(item.handle.as_raw_handle(), 0) } == WAIT_OBJECT_0;
            results[*index].status = if closed {
                Status::Closed
            } else {
                Status::Pending
            };
            if closed {
                closed_count += 1;
                closed_memory_bytes += item.memory_bytes;
            }
            !closed
        });
        if posted.is_empty() || Instant::now() >= deadline {
            break;
        }
        thread::sleep(Duration::from_millis(50));
    }
    CloseReport {
        results,
        closed_count,
        closed_memory_bytes,
        protected_count: protected.len(),
        available_before_bytes,
        available_after_bytes: available(),
    }
}

#[tauri::command]
pub(crate) async fn optimizer_close() -> Result<CloseReport> {
    static CLOSE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = CLOSE
        .try_lock()
        .map_err(|_| AppError::new("optimizer", "Já há uma otimização em andamento."))?;
    let before = available();
    let items = tokio::task::spawn_blocking(scan)
        .await
        .map_err(|_| unavailable())??;
    let protected = crate::pm2::optimizer_protection().await?;
    tokio::task::spawn_blocking(move || request_close(items, &protected, before))
        .await
        .map_err(|_| unavailable())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_excludes_editors_services_and_unknown_programs() {
        assert_eq!(catalog_app("CHARMAP.EXE").unwrap().key, "character-map");
        for name in [
            "notepad.exe",
            "mspaint.exe",
            "node.exe",
            "sqlservr.exe",
            "postgres.exe",
            "taskmgr.exe",
            "powershell.exe",
            "other.exe",
        ] {
            assert!(catalog_app(name).is_none(), "{name}");
        }
    }

    #[test]
    fn protects_foreground_changed_identity_and_explicit_pm2_pids() {
        // This test operates on its own identity and never sends a window message.
        let pid = std::process::id();
        let handle = open(pid).unwrap();
        let raw = handle.as_raw_handle();
        let mut item = Item {
            app: &CATALOG[0],
            pid,
            shell_pid: 0,
            started: creation(raw).unwrap(),
            image: image(raw).unwrap(),
            memory_bytes: 1,
            handle,
            window: 0,
            classic: true,
        };
        assert!(same_instance(&item));
        assert!(!eligible_window(
            &item,
            pid,
            &HashMap::from([(pid, Some(0))])
        ));
        item.started += 1;
        assert!(!same_instance(&item));
        item.started -= 1;
        item.image.push('x');
        assert!(!same_instance(&item));
        let report = request_close(vec![item], &HashSet::from([pid]), None);
        assert_eq!(report.protected_count, 1);
        assert_eq!(report.results[0].status, Status::Skipped);
        assert_eq!((report.closed_count, report.closed_memory_bytes), (0, 0));
    }
}
