param([int]$AppPid)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$app = Get-Process -Id $AppPid
function Find-Element([string]$name, [bool]$button) {
  $end = [datetime]::UtcNow.AddSeconds(45)
  do {
    $app.Refresh()
    if ($app.HasExited) { throw 'O JUJUBA encerrou durante o teste.' }
    if ($app.MainWindowHandle -ne 0) {
      $root = [System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
      $matchName = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,$name)
      $items = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$matchName)
      foreach ($item in $items) {
        if (!$button -or ($item.Current.ControlType.ProgrammaticName -eq 'ControlType.Button' -and $item.Current.IsEnabled)) { return $item }
      }
    }
    Start-Sleep -Milliseconds 350
  } while ([datetime]::UtcNow -lt $end)
  throw "Elemento indisponível: $name"
}
foreach ($name in 'Fluxogramas','Pedidos') {
  $button = Find-Element $name $true
  $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
}
$null = Find-Element 'Telas e processos' $false
$null = Find-Element 'Pasta vinculada' $true
