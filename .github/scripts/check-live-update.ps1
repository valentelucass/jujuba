# Exercita apenas a instalação descartável do runner do GitHub.
$ErrorActionPreference = 'Stop'
if ($env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows') { throw 'Teste exclusivo do Windows do GitHub Actions.' }
$from = $env:START_VERSION
if ($from -notmatch '^\d+\.\d+\.\d+$') { throw 'Versão inicial inválida.' }
$feed = Invoke-RestMethod "https://github.com/$env:GITHUB_REPOSITORY/releases/latest/download/latest.json"
$to = $feed.version
if ([version]$to -le [version]$from) { throw "O feed $to precisa ser posterior a $from." }
$release = gh api "repos/$env:GITHUB_REPOSITORY/releases/tags/v$from" | ConvertFrom-Json
$asset = @($release.assets | Where-Object name -like '*_x64-setup.exe')
if ($asset.Count -ne 1) { throw 'Instalador de origem ambíguo.' }
$installer = Join-Path $env:RUNNER_TEMP 'jujuba-inicial.exe'
Invoke-WebRequest $asset[0].browser_download_url -OutFile $installer
$hash = (Get-FileHash $installer -Algorithm SHA256).Hash.ToLowerInvariant()
if ("sha256:$hash" -ne $asset[0].digest) { throw 'Hash do instalador diverge da release.' }
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--force-renderer-accessibility'
$process = Start-Process $installer -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden
if ($process.ExitCode) { throw "Falha ao instalar $from ($($process.ExitCode))." }
$key = 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/Jujuba'
$initial = Get-ItemProperty $key
if ($initial.DisplayVersion -ne $from) { throw 'Versão inicial incorreta.' }
$exe = Join-Path $initial.InstallLocation.Trim('"') 'jujubasql.exe'
$app = Start-Process $exe -PassThru
powershell -NoProfile -File .github/scripts/click-update.ps1 -AppPid $app.Id -FromVersion $from -ToVersion $to
if ($LASTEXITCODE) {
  Get-Process -Name jujubasql,msedgewebview2 -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,MainWindowTitle,SessionId | Out-Host
  Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime=(Get-Date).AddMinutes(-4); Level=2} -ErrorAction SilentlyContinue |
    Select-Object -First 5 -ExpandProperty Message | Out-Host
  throw "O teste perdeu acesso à interface. Processo inicial encerrado: $($app.HasExited), código: $($app.ExitCode)."
}
$end = [datetime]::UtcNow.AddMinutes(2)
do {
  $installed = Get-ItemProperty $key -ErrorAction SilentlyContinue
  $new = Get-Process -Name jujubasql -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $app.Id -and $_.Path -eq $exe }
  if ($app.HasExited -and $installed.DisplayVersion -eq $to -and $new -and (Get-Item $exe).VersionInfo.ProductVersion -eq $to) {
    powershell -NoProfile -File .github/scripts/click-update.ps1 -AppPid $new.Id -ToVersion $to -VerifyOnly
    if ($LASTEXITCODE) { throw 'A janela da nova versão não ficou pronta.' }
    Write-Host "Botão confirmado: $from → $to no mesmo executável. A nova versão abriu com PID $($new.Id)."
    exit 0
  }
  Start-Sleep -Seconds 2
} while ([datetime]::UtcNow -lt $end)
Get-Process | Where-Object MainWindowTitle | Select-Object ProcessName, MainWindowTitle
throw "Atualização incompleta. Registro $($installed.DisplayVersion), arquivo $((Get-Item $exe).VersionInfo.ProductVersion), processo anterior encerrado $($app.HasExited)."
