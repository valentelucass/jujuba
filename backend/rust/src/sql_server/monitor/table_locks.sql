SELECT l.request_session_id AS sid,
MIN(QUOTENAME(SCHEMA_NAME(t.schema_id)) + '.' + QUOTENAME(t.name)) AS table_name
FROM sys.dm_tran_locks l JOIN sys.tables t ON t.object_id = l.resource_associated_entity_id
WHERE l.resource_database_id = DB_ID() AND l.resource_type = 'OBJECT' AND t.is_ms_shipped = 0
  AND l.request_session_id IN (SELECT TOP (50) r.session_id FROM sys.dm_exec_requests r
    JOIN sys.dm_exec_sessions s ON s.session_id=r.session_id
    WHERE r.database_id = DB_ID() AND r.session_id <> @@SPID AND s.is_user_process = 1
    ORDER BY r.total_elapsed_time DESC, r.session_id, r.request_id)
GROUP BY l.request_session_id
