# Runs only on a disposable GitHub-hosted Windows runner.
$ErrorActionPreference = 'Stop'
$legacyInstaller = Join-Path $env:RUNNER_TEMP 'jujuba-before-rename.exe'
Invoke-WebRequest -Uri 'https://github.com/valentelucass/jujuba/releases/download/v0.1.58/JujubaSQL_0.1.58_x64-setup.exe' -OutFile $legacyInstaller
if ((Get-FileHash $legacyInstaller -Algorithm SHA256).Hash -ne '1006c1ee88cf81da2276d02091e5c9f4f2b18fc605112c18e4bdcb264945bcad') { throw 'Unexpected previous installer.' }

function Install-TestBuild($path, $arguments) {
  $process = Start-Process -FilePath $path -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -ne 0) { throw "Installer exited with code $($process.ExitCode)." }
}
Install-TestBuild $legacyInstaller @('/S')
$registry = 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall'
$old = Get-ItemProperty "$registry/JujubaSQL"
$originalDir = $old.InstallLocation.Trim('"')
$shell = New-Object -ComObject WScript.Shell
$folders = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
foreach ($folder in $folders) {
  if (!(Test-Path -LiteralPath (Join-Path $folder 'JujubaSQL.lnk'))) { throw 'Missing legacy shortcut in test setup.' }
}
$version = $env:GITHUB_REF_NAME.Substring(1)
$installer = Get-Item "backend/rust/target/x86_64-pc-windows-msvc/release/bundle/nsis/Jujuba_${version}_x64-setup.exe"
Install-TestBuild $installer.FullName @('/S', '/UPDATE')
$current = Get-ItemProperty "$registry/Jujuba"
if ($current.DisplayName -ne 'Jujuba' -or $current.DisplayVersion -ne $version -or $current.InstallLocation.Trim('"') -ne $originalDir) { throw 'Upgrade registration mismatch.' }
if (Test-Path "$registry/JujubaSQL") { throw 'Duplicate legacy installation registration.' }
foreach ($folder in $folders) {
  $path = Join-Path $folder 'Jujuba.lnk'
  if (!(Test-Path -LiteralPath $path) -or (Test-Path -LiteralPath (Join-Path $folder 'JujubaSQL.lnk'))) { throw 'Shortcut rename failed.' }
  $target = $shell.CreateShortcut($path).TargetPath
  if (!(Test-Path -LiteralPath $target) -or $target -ne (Join-Path $originalDir 'jujubasql.exe')) { throw 'Shortcut points at the wrong executable.' }
}
