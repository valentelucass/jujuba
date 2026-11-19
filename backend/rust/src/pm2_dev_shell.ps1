# This runs after the user's profile, in the interactive PowerShell process itself.
& {
    $project = $env:JUJUBA_DEV_PROJECT
    [Environment]::SetEnvironmentVariable('JUJUBA_DEV_PROJECT', $null, 'Process')
    Set-Location -LiteralPath $project -ErrorAction Stop

    $discover = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    $loaded = $false
    if ([IO.File]::Exists($discover)) {
        $previousEncoding = [Console]::OutputEncoding
        try {
            [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
            $installations = @(& $discover -products '*' -prerelease -sort -utf8 -property installationPath)
        } finally { [Console]::OutputEncoding = $previousEncoding }
        foreach ($installation in $installations) {
            if (-not [IO.Directory]::Exists($installation)) { continue }
            $tools = Join-Path $installation 'Common7\Tools'
            $launcher = Join-Path $tools 'Launch-VsDevShell.ps1'
            if ([IO.File]::Exists($launcher)) {
                try {
                    $ErrorActionPreference = 'Stop'
                    & $launcher -SkipAutomaticLocation
                    $loaded = $? -and [bool]$env:VSCMD_VER
                } catch { $loaded = $false }
            }
            if ($loaded) { break }
            # Microsoft's Start menu shortcut can also load the compiled module directly.
            foreach ($module in @('Microsoft.VisualStudio.DevShell.dll', 'vsdevshell\Microsoft.VisualStudio.DevShell.dll')) {
                $dll = Join-Path $tools $module
                if (-not [IO.File]::Exists($dll)) { continue }
                try {
                    Import-Module -Name $dll -Global -ErrorAction Stop
                    Microsoft.VisualStudio.DevShell\Enter-VsDevShell -VsInstallPath $installation -SkipAutomaticLocation -ErrorAction Stop
                    $loaded = $? -and [bool]$env:VSCMD_VER
                } catch { $loaded = $false }
                if ($loaded) { break }
            }
            if ($loaded) { break }
        }
    }

    # A profile and some older VS launchers can change the working directory.
    Set-Location -LiteralPath $project -ErrorAction Stop
    $bin = Join-Path $project 'node_modules\.bin'
    $env:Path = (@($bin) + @($env:Path -split ';' | Where-Object { $_ -and $_ -ne $bin })) -join ';'
    if ($loaded) { Write-Host "Developer PowerShell do Visual Studio $env:VSCMD_VER. Pasta do projeto: $project" }
    else { Write-Host "PowerShell de desenvolvimento Node. Pasta do projeto: $project" }
    Write-Host "Comandos locais do projeto: $bin"
}
