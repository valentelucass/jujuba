param([System.Data.SqlClient.SqlConnection]$Connection)
$ErrorActionPreference = 'Stop'
# The caller owns a disposable LocalDB database. Run the shipped dashboard query against known byte counts.
$query = [IO.File]::ReadAllText((Resolve-Path 'backend/rust/src/sql_server/column_storage.sql'))
$command = $Connection.CreateCommand()
try {
    $command.CommandText = @'
CREATE TABLE dbo.[Storage.detail] (
    id int NOT NULL,
    [label]] text] nvarchar(20),
    payload varbinary(max),
    absent bigint,
    calculated AS (id + 1),
    stored AS (id + 1) PERSISTED
);
INSERT dbo.[Storage.detail] (id, [label]] text], payload) VALUES (1, N'ab ', 0x000102), (2, N'', NULL);
SELECT OBJECT_ID(N'dbo.[Storage.detail]');
'@
    $id = $command.ExecuteScalar()
    $command.CommandText = $query
    [void]$command.Parameters.Add('@P1', [Data.SqlDbType]::Int)
    $command.Parameters['@P1'].Value = $id
    [void]$command.Parameters.Add('@P2', [Data.SqlDbType]::Int)
    $expected = @{ id = 8; 'label] text' = 6; payload = 3; absent = 0; stored = 8 }
    foreach ($mode in @(0, 1)) {
        $command.Parameters['@P2'].Value = $mode
        $reader = $command.ExecuteReader()
        try {
            $seen = @()
            while ($reader.Read()) {
                $name = [string]$reader['name']
                $seen += $name
                if ($reader['method'] -ne 'full' -or $reader['measured_rows'] -ne '2') { throw 'Expected a complete measurement of two rows.' }
                if ($name -eq 'calculated') {
                    if ($reader['reason'] -ne 'virtual' -or !($reader['measured_bytes'] -is [DBNull])) { throw 'Virtual column counted as stored.' }
                } elseif (!$expected.ContainsKey($name) -or $reader.IsDBNull($reader.GetOrdinal('measured_bytes')) -or [long]$reader['measured_bytes'] -ne $expected[$name]) {
                    throw "Wrong byte count for '$name'. Bytes='$($reader['measured_bytes'])' Reason='$($reader['reason'])'."
                }
            }
            if ($seen.Count -ne 6) { throw 'Missing columns in storage detail.' }
        } finally { $reader.Dispose() }
    }
    $clear = $Connection.CreateCommand()
    try {
        $clear.CommandText = 'DELETE FROM dbo.[Storage.detail]'
        [void]$clear.ExecuteNonQuery()
    } finally { $clear.Dispose() }
    $command.Parameters['@P2'].Value = 0
    $empty = $command.ExecuteReader()
    try {
        if (!$empty.Read() -or $empty['method'] -ne 'full' -or $empty['measured_rows'] -ne '0' -or $empty['measured_bytes'] -ne '0') {
            throw 'An empty table should have zero measured rows and zero bytes.'
        }
    } finally { $empty.Dispose() }
} finally { $command.Dispose() }
