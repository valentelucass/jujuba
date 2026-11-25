[CmdletBinding()]
param([string]$Resultado)
$ErrorActionPreference = 'Stop'
$localDb = Get-Command SqlLocalDB.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
if (!$localDb) {
    $localDb = Get-ChildItem "$env:ProgramFiles/Microsoft SQL Server/*/Tools/Binn/SqlLocalDB.exe" |
        Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (!$localDb) { throw 'O ensaio exige SQL Server LocalDB no computador de laboratório.' }
$instance = 'JujubaRet_' + [guid]::NewGuid().ToString('N')
$database = 'JujubaRetencaoLab'
function Connect-Lab([string]$name) {
    $connection = [System.Data.SqlClient.SqlConnection]::new("Server=(localdb)\$instance;Database=$name;Integrated Security=true;Pooling=false;Connect Timeout=25")
    $connection.Open()
    return $connection
}
function Invoke-LabSql($connection, [string]$sql, [switch]$Scalar) {
    $cmd = $connection.CreateCommand()
    try {
        $cmd.CommandText = $sql
        $cmd.CommandTimeout = 25
        if ($Scalar) { return $cmd.ExecuteScalar() }
        [void]$cmd.ExecuteNonQuery()
    } finally { $cmd.Dispose() }
}

$created = $false
$master = $db = $other = $null
try {
    & $localDb create $instance -s
    if ($LASTEXITCODE) { throw "Falha ao iniciar a instância exclusiva. Código $LASTEXITCODE" }
    $created = $true
    $master = Connect-Lab master
    if ((Invoke-LabSql $master "SELECT CONVERT(int,SERVERPROPERTY('IsLocalDB'))" -Scalar) -ne 1) {
        throw 'A conexão não é LocalDB.'
    }
    Invoke-LabSql $master 'CREATE DATABASE JujubaRetencaoLab'
    $db = Connect-Lab $database
    foreach ($file in 'estrutura.sql','cenarios.sql') {
        $source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot $file))
        foreach ($batch in [regex]::Split($source,'(?im)^\s*GO\s*$')) {
            if ($batch.Trim()) { Invoke-LabSql $db $batch }
        }
    }

    # Enquanto uma carga detém a entidade, o leitor deve desistir sem tocar no lote.
    $other = Connect-Lab $database
    Invoke-LabSql $other "BEGIN TRAN; EXEC lab.Travar 'OCORRENCIAS';"
    try {
        Invoke-LabSql $db "DECLARE @d date; EXEC lab.LimparDia 'ocorrencias','20261127',@d OUTPUT;"
        throw 'Duas sessões obtiveram a mesma entidade ao mesmo tempo.'
    } catch {
        if ($_.Exception.GetBaseException().Number -ne 54001) { throw }
    }
    Invoke-LabSql $other 'ROLLBACK'
    Invoke-LabSql $db "DECLARE @d date; EXEC lab.LimparDia 'OCORRENCIAS','20261127',@d OUTPUT;"
    Invoke-LabSql $db "INSERT #testes VALUES (N'Concorrência de duas conexões e retomada da rodada');"

    $proof = [ordered]@{
        motor = Invoke-LabSql $db "SELECT CONCAT(SERVERPROPERTY('Edition'),' ',SERVERPROPERTY('ProductVersion'))" -Scalar
        instanciaDescartavel = $true
        datas = (Invoke-LabSql $db 'SELECT (SELECT * FROM #rodadas ORDER BY hoje FOR JSON PATH)' -Scalar | ConvertFrom-Json)
        testes = @((Invoke-LabSql $db 'SELECT (SELECT nome FROM #testes ORDER BY nome FOR JSON PATH)' -Scalar | ConvertFrom-Json) | ForEach-Object nome)
        revisao = $env:GITHUB_SHA
    }
    $json = $proof | ConvertTo-Json -Depth 5
    if ($Resultado) { [IO.File]::WriteAllText([IO.Path]::GetFullPath($Resultado),$json,[Text.UTF8Encoding]::new($false)) }
    Write-Output $json
} finally {
    foreach ($connection in @($master,$db,$other)) { if ($connection) { $connection.Dispose() } }
    if ($created) {
        & $localDb stop $instance -k
        if ($LASTEXITCODE) { throw 'Falha ao encerrar a instância exclusiva.' }
        & $localDb delete $instance
        if ($LASTEXITCODE) { throw 'Falha ao retirar a instância exclusiva.' }
    }
}
