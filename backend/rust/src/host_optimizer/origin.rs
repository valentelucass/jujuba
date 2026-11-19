use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    os::windows::process::CommandExt,
    path::{Component, Path, PathBuf, Prefix},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::HANDLE,
    Storage::{
        FileSystem::GetDriveTypeW,
        Packaging::Appx::{
            GetPackageFamilyName, GetPackageFullName, GetPackagePathByFullName,
            GetStagedPackageOrigin, PackageOrigin_Inbox, PackageOrigin_Store,
        },
    },
    System::Threading::CREATE_NO_WINDOW,
};

fn package_string(api: impl FnOnce(&mut u32, *mut u16) -> u32) -> Option<String> {
    let mut text = vec![0u16; 32768];
    let mut count = text.len() as u32;
    (api(&mut count, text.as_mut_ptr()) == 0 && count > 1 && count as usize <= text.len())
        .then(|| String::from_utf16_lossy(&text[..count as usize - 1]))
}

pub(super) fn trusted_package(handle: HANDLE, path: &Path) -> Option<String> {
    let check = || -> Option<String> {
        let actual = package_string(|n, p| unsafe { GetPackageFamilyName(handle, n, p) })?;
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
        (in_windows_apps && Path::new(&path.to_string_lossy().to_lowercase()).starts_with(install))
            .then_some(actual)
    };
    check()
}

// Authenticode also checks catalog signatures of Windows system files. Input paths
// travel as JSON on stdin; no executable path or UI value is evaluated as script.
pub(super) fn signatures(system: &Path, paths: &HashSet<String>) -> Option<HashMap<String, bool>> {
    const VERIFY: &str = r#"
$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = [Console]::InputEncoding
foreach ($p in (ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd()))) {
  try {
    $s = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $p
    if ($s.Status -ne 'Valid' -or -not $s.SignerCertificate) { [Console]::Write('x') }
    elseif ($s.SignerCertificate.GetNameInfo('SimpleName',$false) -in @('Microsoft Windows','Microsoft Windows Publisher','Microsoft Corporation')) { [Console]::Write('m') }
    else { [Console]::Write('s') }
  } catch { [Console]::Write('x') }
}
"#;
    if paths.len() > 1024 {
        return None;
    }
    let ordered: Vec<_> = paths.iter().cloned().collect();
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
    let payload = serde_json::to_vec(&ordered).ok()?;
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
    if output.stdout.len() != ordered.len() {
        return None;
    }
    Some(
        ordered
            .into_iter()
            .zip(output.stdout)
            .filter_map(|(p, c)| match c {
                b'm' => Some((p, true)),
                b's' => Some((p, false)),
                _ => None,
            })
            .collect(),
    )
}

// The PE subsystem identifies a GUI image. Console workers also have signed builds
// and can own windows, so neither a publisher nor a window alone establishes this.
pub(super) fn local_gui(path: &Path) -> bool {
    let probe = || -> Option<bool> {
        let Component::Prefix(prefix) = path.components().next()? else {
            return None;
        };
        let (Prefix::Disk(drive) | Prefix::VerbatimDisk(drive)) = prefix.kind() else {
            return None;
        };
        let root = [drive as u16, b':' as u16, u16::from(92u8), 0];
        if unsafe { GetDriveTypeW(root.as_ptr()) } != 3 {
            return None;
        } // DRIVE_FIXED
        let mut f = File::open(path).ok()?;
        let mut dos = [0; 64];
        f.read_exact(&mut dos).ok()?;
        if &dos[..2] != b"MZ" {
            return None;
        }
        let offset = u32::from_le_bytes(dos[60..64].try_into().ok()?);
        if !(64..=1024 * 1024).contains(&offset) {
            return None;
        }
        f.seek(SeekFrom::Start(offset as u64)).ok()?;
        let mut pe = [0; 94];
        f.read_exact(&mut pe).ok()?;
        let optional_size = u16::from_le_bytes([pe[20], pe[21]]);
        let magic = u16::from_le_bytes([pe[24], pe[25]]);
        Some(
            &pe[..4] == b"PE\0\0"
                && optional_size >= 70
                && matches!(magic, 0x10b | 0x20b)
                && u16::from_le_bytes([pe[92], pe[93]]) == 2,
        )
    };
    probe() == Some(true)
}

pub(super) fn sensitive_image(path: &str) -> bool {
    // These are exclusions, never a source of eligibility. Directory components
    // also catch a generic UI host shipped as part of a backup/security suite.
    let lower = path.to_ascii_lowercase();
    let protected = [
        "backup",
        "antivirus",
        "endpoint security",
        "endpoint protection",
        "defender",
        "securityhealth",
        "crowdstrike",
        "sentinelone",
        "sentinel agent",
        "bitdefender",
        "eset security",
        "kaspersky",
        "veeam",
        "acronis",
        "commvault",
        "rubrik",
        "datadog",
        "monitoring agent",
        "remotedesktop",
        "teamviewer",
        "anydesk",
        "virtualbox",
        "vmware",
        "hyper-v",
        "installer",
        "uninstall",
        "updater",
        "setup.exe",
        "update.exe",
        "msiexec",
        "windowsupdate",
        "windows terminal",
        "visual studio",
        "database",
        "sql server",
        "mongodb",
        "postgresql",
        "arcserve",
        "vpn",
        "wireshark",
    ];
    protected.iter().any(|text| lower.contains(text))
}
