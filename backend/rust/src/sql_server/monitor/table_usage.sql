SELECT TOP (20) QUOTENAME(SCHEMA_NAME(t.schema_id)) + '.' + QUOTENAME(t.name) AS table_name,
CONVERT(varchar(32), SUM(i.user_seeks + i.user_scans + i.user_lookups + i.user_updates)) AS hits
FROM sys.dm_db_index_usage_stats i JOIN sys.tables t ON t.object_id = i.object_id
WHERE i.database_id = DB_ID() AND t.is_ms_shipped = 0 GROUP BY t.schema_id, t.name
HAVING SUM(i.user_seeks + i.user_scans + i.user_lookups + i.user_updates) > 0
ORDER BY SUM(i.user_seeks + i.user_scans + i.user_lookups + i.user_updates) DESC, table_name
