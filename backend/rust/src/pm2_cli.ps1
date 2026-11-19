$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

try {
    $pm2 = $null
    foreach ($tool in @('pm2.cmd', 'pm2.exe', 'pm2.ps1')) {
        $entry = Get-Command -Name $tool -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($entry) { $pm2 = $entry.Source; break }
    }
    if (-not $pm2 -and $env:APPDATA) {
        $npmShim = Join-Path $env:APPDATA 'npm\pm2.cmd'
        if ([IO.File]::Exists($npmShim)) { $pm2 = $npmShim }
    }
    if (-not $pm2) { exit 81 }

    $operation = $env:JUJUBASQL_PM2_ACTION
    $pm2Home = $env:PM2_HOME
    if (-not $pm2Home) { $pm2Home = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.pm2' }
    $daemonFile = $env:PM2_PID_FILE_PATH
    if (-not $daemonFile) { $daemonFile = Join-Path $pm2Home 'pm2.pid' }
    # These two explicit actions can start the daemon. Polling cannot.
    if ($operation -notin @('start-file', 'resurrect')) {
        if (-not [IO.File]::Exists($daemonFile)) { exit 82 }
        $daemonPid = 0
        if (-not [int]::TryParse([IO.File]::ReadAllText($daemonFile).Trim(), [ref]$daemonPid) -or $daemonPid -le 0) { exit 82 }
        $daemon = Get-Process -Id $daemonPid -ErrorAction SilentlyContinue
        if (-not $daemon -or $daemon.StartTime.ToUniversalTime() -gt [IO.File]::GetLastWriteTimeUtc($daemonFile).AddSeconds(1)) { exit 82 }
    }

    $targetId = $env:JUJUBASQL_PM2_ID
    $targetName = $env:JUJUBASQL_PM2_NAME
    $instances = $env:JUJUBASQL_PM2_INSTANCES
    $selectedFile = $env:JUJUBASQL_PM2_FILE
    # Do not save JUJUBA's transport fields in a new app's PM2 environment.
    foreach ($key in @('ACTION', 'ID', 'NAME', 'INSTANCES', 'FILE')) {
        [Environment]::SetEnvironmentVariable("JUJUBASQL_PM2_$key", $null, 'Process')
    }
    if ($operation -eq 'jlist') {
        $env:NO_COLOR = '1'
        & $pm2 jlist
    } elseif ($operation -in @('start', 'stop', 'restart', 'reload', 'delete') -and $targetId -cmatch '^[0-9]+$') {
        & $pm2 $operation $targetId | Out-Null
    } elseif ($operation -eq 'save') {
        & $pm2 save --force | Out-Null
    } elseif ($operation -eq 'resurrect') {
        $dump = $env:PM2_DUMP_FILE_PATH
        $backup = $env:PM2_DUMP_BACKUP_FILE_PATH
        if (-not $dump) { $dump = Join-Path $pm2Home 'dump.pm2' }
        if (-not $backup) { $backup = Join-Path $pm2Home 'dump.pm2.bak' }
        if (-not [IO.File]::Exists($dump) -and -not [IO.File]::Exists($backup)) { exit 84 }
        & $pm2 resurrect | Out-Null
    } elseif ($operation -in @('logs', 'describe', 'monit') -and $targetId -cmatch '^[0-9]+$') {
        if ($operation -eq 'monit') { & $pm2 monit }
        else { & $pm2 $operation $targetId }
        return
    } elseif ($operation -in @('start-file', 'scale')) {
        if ($operation -eq 'scale') {
            if (-not $targetName -or $instances -notmatch '^[0-9]+$') { exit 83 }
            $parameters = @('scale', '--', $targetName, $instances)
        } else {
            if (-not [IO.File]::Exists($selectedFile)) { exit 83 }
            $parameters = @('start', $selectedFile)
        }
        # npm's .cmd shim reinterprets special characters. Pass arbitrary names and
        # filenames directly to Node's argv, or use the package manager's PowerShell shim.
        if ([IO.Path]::GetExtension($pm2) -ieq '.cmd') {
            $dir = Split-Path -Parent $pm2
            $entry = @((Join-Path $dir 'node_modules/pm2/bin/pm2'), (Join-Path $dir '../pm2/bin/pm2')) |
                Where-Object { [IO.File]::Exists($_) } | Select-Object -First 1
            if ($entry) {
                $node = Join-Path $dir 'node.exe'
                if (-not [IO.File]::Exists($node)) { $node = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source }
                # Windows PowerShell's legacy argv formatter strips embedded
                # quotes. Transport the arguments as data to the official CLI.
                $env:JUJUBA_PM2_ENTRY = [IO.Path]::GetFullPath($entry)
                $env:JUJUBA_PM2_ARGV = ConvertTo-Json -InputObject $parameters -Compress
                $invoke = 'const cli=process.env.JUJUBA_PM2_ENTRY; const args=JSON.parse(process.env.JUJUBA_PM2_ARGV); delete process.env.JUJUBA_PM2_ENTRY; delete process.env.JUJUBA_PM2_ARGV; process.argv=[process.execPath,cli,...args]; require(cli)'
                & $node -e $invoke | Out-Null
            } else {
                if ($targetName -and $targetName.Contains('"')) { exit 85 }
                $shim = [IO.Path]::ChangeExtension($pm2, 'ps1')
                if (-not [IO.File]::Exists($shim)) { exit 85 }
                & $shim @parameters | Out-Null
            }
        } else { & $pm2 @parameters | Out-Null }
    } else { exit 83 }
    if ($LASTEXITCODE -ne 0) { exit 83 }
} catch { exit 83 }
exit 0
