WITH requests AS (
    SELECT session_id, database_id, command, wait_type, status, total_elapsed_time, request_id,
           ROW_NUMBER() OVER (
               PARTITION BY session_id
               ORDER BY CASE WHEN database_id = DB_ID() THEN 0 ELSE 1 END, total_elapsed_time DESC, request_id
           ) AS request_rank
    FROM sys.dm_exec_requests WHERE session_id <> @@SPID
)
SELECT TOP (50) CONVERT(varchar(12), s.session_id) AS sid, s.program_name, s.host_name, r.command,
       COALESCE(r.wait_type, r.status, s.status) AS state,
       CONVERT(varchar(24), CASE WHEN r.total_elapsed_time >= 0 THEN r.total_elapsed_time END) AS elapsed_ms
FROM sys.dm_exec_sessions s
LEFT JOIN requests r ON s.session_id = r.session_id AND r.request_rank = 1
WHERE s.is_user_process = 1 AND s.session_id <> @@SPID AND COALESCE(r.database_id, s.database_id) = DB_ID()
ORDER BY CASE WHEN r.request_id IS NULL THEN 1 ELSE 0 END, r.total_elapsed_time DESC, s.session_id, r.request_id
