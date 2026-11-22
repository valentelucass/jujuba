# Exercise the installed scheduler on the disposable release runner.
$ErrorActionPreference = 'Stop'
if ($env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Use a disposable GitHub-hosted runner.' }
$version = $env:GITHUB_REF_NAME.Substring(1)
$installer = Get-Item "backend/rust/target/x86_64-pc-windows-msvc/release/bundle/nsis/Jujuba_$($version)_x64-setup.exe"
$install = Start-Process $installer.FullName -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden
if ($install.ExitCode) { throw "Installer failed ($($install.ExitCode))" }
$installDir = (Get-ItemProperty 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/Jujuba').InstallLocation.Trim('"')
$fixture = Join-Path $env:RUNNER_TEMP 'jujuba-source-test'
$stub = Join-Path $fixture 'node_modules/@openai/codex/bin'
$source = Join-Path $fixture 'Pedidos'
$library = Join-Path $env:APPDATA 'br.nexosql.studio/fluxogramas'
$links = Join-Path $library 'sources'
New-Item -Force -ItemType Directory $stub,$source,$links | Out-Null
$id = [guid]::NewGuid().ToString()
$key = [guid]::NewGuid().ToString()
@{title='Pedidos';folder=$source;key=$key} | ConvertTo-Json | Set-Content "$links/$id.link.json" -Encoding utf8NoBOM
@{id=$id;diagram=@{title='Pedidos';summary='';nodes=@();edges=@()};file=$null;fileDirty=$true} | ConvertTo-Json -Depth 5 | Set-Content "$library/$id.json" -Encoding utf8NoBOM
@'
const fs = require('node:fs')
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', x => input += x)
process.stdin.on('end', () => {
  const label = input.includes('REGRA_NOVA') ? 'Separar o pedido' : 'Receber o pedido'
  const graph = {title:'Pedidos',summary:label,behaviorChanged:true,nodes:[
    {id:'inicio',kind:'start',label,detail:label},{id:'fim',kind:'end',label:'Concluir',detail:'Concluir o pedido.'}
  ],edges:[{from:'inicio',to:'fim',label:''}],requirements:[],openQuestions:[],
    areas:[{title:'Pedidos',entry:'inicio',steps:[label],files:['pedidos.js']}]}
  const schema = JSON.parse(fs.readFileSync('schema.json','utf8'))
  const options = Array.from({length:8}, (_, i) => ({label:'Opção '+(i+1),to:i+2}))
  const response = schema.properties.processes ? {processes:[{index:0,steps:[
    {label,detail:'Escolher a próxima atividade do pedido.',source:1,choices:[{label:'Tentar novamente',to:1},...options]},
    ...options.map((item) => ({label:item.label,detail:'Concluir a atividade selecionada.',source:1,choices:[{label:'',to:0}]}))
  ]}]} : graph
  fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],JSON.stringify(response))
})
'@ | Set-Content "$stub/codex.js" -Encoding utf8NoBOM
$env:PATH = "$fixture;$env:PATH"
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--force-renderer-accessibility'
$worker = Join-Path $installDir 'resources/source-worker.mjs'
if (!(Test-Path -LiteralPath $worker -PathType Leaf)) { throw 'The source worker was not installed.' }
'export const etapa = "REGRA_ANTIGA"' | Set-Content "$source/pedidos.js"
$app = Start-Process (Join-Path $installDir 'jujubasql.exe') -PassThru -WindowStyle Hidden
function Wait-Flow($label) {
  $limit = [datetime]::UtcNow.AddMinutes(2)
  do {
    if ($app.HasExited) { throw 'The installed JUJUBA exited.' }
    if (Test-Path "$links/$key.result.json") {
      $result = Get-Content "$links/$key.result.json" -Raw | ConvertFrom-Json
      if ($result.format -eq 2 -and $result.answer.summary -eq $label -and
          $result.answer.areas[0].flow.nodes[1].label -eq $label -and
          $result.answer.areas[0].flow.references.p1 -eq 'pedidos.js') { return }
    }
    Start-Sleep -Seconds 1
  } while ([datetime]::UtcNow -lt $limit)
  if (Test-Path "$links/$key.status.json") { Get-Content "$links/$key.status.json" }
  else {
    Write-Host "Fixture $library | Roaming folder $([Environment]::GetFolderPath('ApplicationData')) | Installed worker $worker"
    Get-ChildItem $library,$links | Select-Object Name,Length | Out-Host
  }
  throw "Expected diagram step: $label"
}
try {
  Wait-Flow 'Receber o pedido'
  # A project saved by 0.1.69 has the same source hash and only an overview.
  $resultPath = Join-Path $links "$key.result.json"
  $legacy = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json -AsHashtable
  $legacy.Remove('format')
  $legacy.Remove('signatures')
  $legacy.answer.areas[0].Remove('flow')
  $legacy | ConvertTo-Json -Depth 32 -Compress | Set-Content -LiteralPath "$resultPath.tmp" -Encoding utf8NoBOM
  [IO.File]::Move("$resultPath.tmp",$resultPath,$true)
  Wait-Flow 'Receber o pedido'
  'export const etapa = "REGRA_NOVA"' | Set-Content "$source/pedidos.js"
  Wait-Flow 'Separar o pedido'
  powershell -NoProfile -File .github/scripts/check-flow-reader.ps1 -AppPid $app.Id
  if ($LASTEXITCODE) { throw 'A tela do projeto instalado não abriu o fluxo da pasta.' }
} finally { if (!$app.HasExited) { $app.Kill(); $app.WaitForExit() } }
