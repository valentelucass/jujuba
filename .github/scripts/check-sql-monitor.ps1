$ErrorActionPreference = 'Stop'
$instance = 'JujubaMonitorQA'
$localDb = Get-Command SqlLocalDB.exe -ErrorAction SilentlyContinue
if (-not $localDb) {
  $localDb = Get-ChildItem (Join-Path $env:ProgramFiles 'Microsoft SQL Server') -Filter SqlLocalDB.exe -Recurse |
    Sort-Object FullName -Descending | Select-Object -First 1
}
if (-not $localDb) { throw 'SQL Server LocalDB is required for this check.' }
$exe = if ($localDb.Source) { $localDb.Source } else { $localDb.FullName }
& $exe create $instance -s
if ($LASTEXITCODE) { throw 'Could not start the test SQL Server.' }

function Open-TestConnection($database, $name) {
  $connection = New-Object System.Data.SqlClient.SqlConnection
  $connection.ConnectionString = "Server=(localdb)\$instance;Database=$database;Integrated Security=true;Application Name=$name;Pooling=false;Asynchronous Processing=true"
  $connection.Open()
  return $connection
}

$admin = $observer = $worker = $null
try {
  $admin = Open-TestConnection master MonitorSetup
  $command = $admin.CreateCommand()
  $command.CommandText = 'CREATE DATABASE JujubaMonitorFixture'
  [void]$command.ExecuteNonQuery()
  $observer = Open-TestConnection JujubaMonitorFixture MonitorObserver
  $command = $observer.CreateCommand()
  $command.CommandText = 'CREATE TABLE dbo.JujubaFixture (id int PRIMARY KEY); INSERT dbo.JujubaFixture VALUES (1)'
  [void]$command.ExecuteNonQuery()
  $worker = Open-TestConnection JujubaMonitorFixture JujubaFixtureApp
  $work = $worker.CreateCommand()
  $work.CommandText = "BEGIN TRAN; UPDATE dbo.JujubaFixture WITH (TABLOCKX) SET id=2 WHERE id=1; WAITFOR DELAY '00:00:30'; ROLLBACK"
  $pending = $work.BeginExecuteNonQuery()
  $command.CommandText = "SELECT COUNT(*) FROM sys.dm_tran_locks WHERE resource_database_id=DB_ID() AND resource_type='OBJECT' AND resource_associated_entity_id=OBJECT_ID('dbo.JujubaFixture') AND request_mode='X' AND request_status='GRANT'"
  for ($i = 0; $i -lt 50 -and $command.ExecuteScalar() -lt 1; $i++) { Start-Sleep -Milliseconds 100 }

  $queries = @(Get-ChildItem backend/rust/src/sql_server/monitor -Filter '*.sql')
  if (!$queries.Count) { throw 'The SQL monitor queries are missing.' }
  $seenApp = $seenTable = $seenMemory = $seenOtherDatabase = $seenUsage = $false
  foreach ($file in $queries) {
    $command.CommandText = Get-Content -LiteralPath $file.FullName -Raw
    $reader = $command.ExecuteReader()
    try {
      while ($reader.Read()) {
        if ($file.BaseName -eq 'sessions') {
          switch ([string]$reader['program_name']) {
            'MonitorObserver' { throw 'The observer appeared in its own sample.' }
            'MonitorSetup' {
              $seenOtherDatabase = ($reader['database_name'] -eq 'master' -and $reader['selected_row'] -eq '0')
            }
            'JujubaFixtureApp' {
              $seenApp = ($reader['selected_row'] -eq '1' -and $reader['database_name'] -eq 'JujubaMonitorFixture' -and [long]$reader['instance_count'] -gt [long]$reader['database_count'])
            }
          }
        }
        if ($file.BaseName -eq 'table_usage' -and $reader['table_name'] -eq '[dbo].[JujubaFixture]') {
          $seenUsage = ([long]$reader['updates'] -gt 0 -and !$reader.IsDBNull($reader.GetOrdinal('last_access')))
        }
        for ($i = 0; $i -lt $reader.FieldCount; $i++) {
          $value = [string]$reader.GetValue($i)
          if ($file.BaseName -match 'lock' -and $value -eq '[dbo].[JujubaFixture]') { $seenTable = $true }
          if ($reader.GetName($i) -eq 'committed' -and [long]$value -gt 0) { $seenMemory = $true }
        }
      }
    } finally { $reader.Close() }
  }
  if (!$seenApp -or !$seenOtherDatabase -or !$seenTable -or !$seenUsage -or !$seenMemory) {
    throw "Incomplete monitor sample. App=$seenApp OtherDatabase=$seenOtherDatabase Lock=$seenTable Usage=$seenUsage Memory=$seenMemory"
  }
} finally {
  if ($work) { $work.Cancel() }
  if ($worker) { $worker.Dispose() }
  if ($observer) { $observer.Dispose() }
  if ($admin) { $admin.Dispose() }
  & $exe stop $instance -k
  & $exe delete $instance
}
