WITH usage_by_table AS (
    SELECT i.object_id,
           SUM(i.user_seeks + i.user_scans + i.user_lookups) AS reads,
           SUM(i.user_updates) AS updates,
           MAX(recent.last_access) AS last_access
    FROM sys.dm_db_index_usage_stats i
    CROSS APPLY (SELECT MAX(v.access_time) AS last_access
                 FROM (VALUES (i.last_user_seek), (i.last_user_scan),
                              (i.last_user_lookup), (i.last_user_update)) v(access_time)) recent
    WHERE i.database_id = DB_ID()
    GROUP BY i.object_id
)
SELECT TOP (20) QUOTENAME(SCHEMA_NAME(t.schema_id)) + '.' + QUOTENAME(t.name) AS table_name,
       CONVERT(varchar(32), u.reads) AS reads, CONVERT(varchar(32), u.updates) AS updates,
       CONVERT(varchar(19), u.last_access, 120) AS last_access
FROM usage_by_table u JOIN sys.tables t ON t.object_id = u.object_id
WHERE t.is_ms_shipped = 0 AND (u.reads > 0 OR u.updates > 0)
ORDER BY u.last_access DESC, t.object_id
