param([int]$AppPid, [string]$FromVersion, [string]$ToVersion)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$app = Get-Process -Id $AppPid
$tree = [System.Windows.Automation.TreeScope]::Descendants
$all = [System.Windows.Automation.Condition]::TrueCondition
function Wait-Button([string]$pattern) {
  $end = [datetime]::UtcNow.AddSeconds(60)
  do {
    $app.Refresh()
    if ($app.HasExited) { throw 'O aplicativo encerrou antes do clique.' }
    if ($app.MainWindowHandle -ne 0) {
      $root = [System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
      $elements = $root.FindAll($tree, $all)
      foreach ($item in $elements) {
        if ($item.Current.ControlType.ProgrammaticName -eq 'ControlType.Button' -and $item.Current.Name -match $pattern -and $item.Current.IsEnabled) {
          return $item
        }
      }
    }
    Start-Sleep -Milliseconds 300
  } while ([datetime]::UtcNow -lt $end)
  $elements | ForEach-Object { $_.Current.Name } | Where-Object { $_ } | Select-Object -Last 70 | Out-Host
  throw "Botão indisponível: $pattern."
}
function Click-Button($button) {
  Write-Host "Botão: $($button.Current.Name)"
  $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
}
Click-Button (Wait-Button '^(Atualizações|Versão .* disponível)$')
$install = Wait-Button '^Atualizar agora$'
$root = [System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
$names = ($root.FindAll($tree, $all) | ForEach-Object { $_.Current.Name }) -join ' '
if (!$names.Contains($FromVersion) -or !$names.Contains($ToVersion)) { throw "A janela não confirmou as versões $FromVersion e $ToVersion." }
Click-Button $install

