SET NOCOUNT ON;
-- @P1 is a table object ID in the current database. @P2 opts into a full scan.
DECLARE @object nvarchar(517), @rows bigint, @pages bigint, @samplePages bit;
SELECT @object = QUOTENAME(s.name) + N'.' + QUOTENAME(t.name),
       @samplePages = CASE WHEN i.type IN (0, 1) AND t.is_memory_optimized = 0
           AND HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'VIEW DEFINITION') = 1
           AND NOT EXISTS (SELECT 1 FROM sys.security_predicates sp
                           JOIN sys.security_policies pol ON pol.object_id = sp.object_id
                           WHERE sp.target_object_id = t.object_id AND pol.is_enabled = 1
                             AND sp.predicate_type = 0)
           THEN 1 ELSE 0 END
FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
LEFT JOIN sys.indexes i ON i.object_id = t.object_id AND i.index_id IN (0, 1)
WHERE t.object_id = @P1 AND t.is_ms_shipped = 0;

SELECT @rows = SUM(row_count), @pages = SUM(used_page_count)
FROM sys.dm_db_partition_stats WHERE object_id = @P1 AND index_id IN (0, 1);

DECLARE @columns TABLE (id int PRIMARY KEY, name sysname, type_name nvarchar(517), reason varchar(20));
INSERT @columns
SELECT c.column_id, c.name,
       CASE WHEN t.is_user_defined = 1 THEN QUOTENAME(SCHEMA_NAME(t.schema_id)) + N'.' + QUOTENAME(t.name)
            WHEN t.name IN ('varchar','nvarchar','char','nchar','varbinary','binary') THEN t.name + N'(' +
                CASE WHEN c.max_length = -1 THEN N'max' ELSE CONVERT(nvarchar(6),
                    CASE WHEN t.name IN ('nvarchar','nchar') THEN c.max_length / 2 ELSE c.max_length END) END + N')'
            WHEN t.name IN ('numeric','decimal') THEN t.name + N'(' + CONVERT(nvarchar(3),c.precision) + N',' + CONVERT(nvarchar(3),c.scale) + N')'
            WHEN t.name IN ('time','datetime2','datetimeoffset') THEN t.name + N'(' + CONVERT(nvarchar(3),c.scale) + N')'
            ELSE t.name END,
       CASE WHEN c.is_hidden = 1 THEN 'hidden'
            WHEN c.is_column_set = 1 THEN 'columnSet'
            WHEN cc.is_persisted = 0 THEN 'virtual'
            WHEN c.encryption_type IS NOT NULL THEN 'encrypted'
            WHEN c.is_masked = 1 AND ISNULL(HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'UNMASK'), 0) = 0 THEN 'masked'
            WHEN NOT EXISTS (SELECT 1 FROM sys.fn_my_permissions(@object, 'OBJECT') p
                             WHERE p.permission_name = 'SELECT'
                               AND p.subentity_name COLLATE Latin1_General_100_BIN2 = c.name COLLATE Latin1_General_100_BIN2) THEN 'denied'
            WHEN c.system_type_id = 240 THEN 'clr' END
FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
LEFT JOIN sys.computed_columns cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id
WHERE c.object_id = @P1 AND @object IS NOT NULL;

DECLARE @method varchar(12) = CASE WHEN @P2 = 1 THEN 'full'
    WHEN @rows <= 4096 AND @pages <= 1024 THEN 'full'
    WHEN @samplePages = 1 AND @rows > 0 THEN 'sample' ELSE 'limited' END;
DECLARE @read nvarchar(max), @sums nvarchar(max), @pairs nvarchar(max);
-- Only catalog identifiers enter the SQL, always quoted. Generated aliases separate arbitrary column names from internal ones.
SELECT @read = STRING_AGG(CONVERT(nvarchar(max), N'CONVERT(bigint,DATALENGTH(' + QUOTENAME(name) + N')) AS ' + alias), N','),
       @sums = STRING_AGG(CONVERT(nvarchar(max), N'COALESCE(SUM(' + alias + N'),0) AS ' + alias), N','),
       @pairs = STRING_AGG(CONVERT(nvarchar(max), N'(' + CONVERT(nvarchar(10),id) + N',a.' + alias + N')'), N',')
FROM @columns CROSS APPLY (VALUES (QUOTENAME(N'c' + CONVERT(nvarchar(10),id)))) names(alias)
WHERE reason IS NULL;

DECLARE @sizes TABLE (id int PRIMARY KEY, bytes bigint, rows_read bigint);
IF @read IS NOT NULL
BEGIN
    DECLARE @statement nvarchar(max) =
        N'WITH src AS (SELECT ' + CASE WHEN @P2 = 1 THEN N'' ELSE N'TOP (8193) ' END + @read +
        N' FROM ' + @object + CASE WHEN @method = 'sample' THEN N' TABLESAMPLE SYSTEM (2048 ROWS)' ELSE N'' END +
        N'), a AS (SELECT COUNT_BIG(*) AS n,' + @sums + N' FROM src)
        SELECT v.id, v.bytes, a.n FROM a CROSS APPLY (VALUES ' + @pairs + N') v(id,bytes) OPTION (MAXDOP 1)';
    INSERT @sizes EXEC sys.sp_executesql @statement;
END;

DECLARE @measured bigint = ISNULL((SELECT TOP (1) rows_read FROM @sizes), 0);
IF @read IS NULL SET @method = 'unavailable';
ELSE IF @P2 = 0 AND @measured = 8193 SET @method = 'limited';
ELSE IF @method = 'limited' SET @method = 'full';

SELECT c.name, c.type_name, c.reason, @method AS method,
       CONVERT(varchar(30), @measured) AS measured_rows,
       CONVERT(varchar(30), @rows) AS catalog_rows,
       CONVERT(varchar(30), CASE WHEN @method = 'sample' AND @measured = 0 THEN NULL ELSE s.bytes END) AS measured_bytes
FROM @columns c LEFT JOIN @sizes s ON s.id = c.id
ORDER BY CASE WHEN c.reason IS NULL THEN 0 ELSE 1 END, s.bytes DESC, c.id;
