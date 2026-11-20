WITH requests AS (
    SELECT session_id, database_id, command, wait_type, status, total_elapsed_time, request_id,
           ROW_NUMBER() OVER (
               PARTITION BY session_id
               ORDER BY CASE WHEN database_id = DB_ID() THEN 0 ELSE 1 END, total_elapsed_time DESC, request_id
           ) AS request_rank
    FROM sys.dm_exec_requests WHERE session_id <> @@SPID
), visible AS (
    SELECT s.session_id, s.program_name, s.host_name, s.last_request_end_time, r.command,
           COALESCE(r.wait_type, r.status, s.status) AS state, r.total_elapsed_time,
           COALESCE(r.database_id, s.database_id) AS database_id,
           CASE WHEN r.request_id IS NULL THEN 1 ELSE 0 END AS idle
    FROM sys.dm_exec_sessions s
    LEFT JOIN requests r ON s.session_id = r.session_id AND r.request_rank = 1
    WHERE s.is_user_process = 1 AND s.session_id <> @@SPID
)
SELECT CONVERT(varchar(12), session_id) AS sid, program_name, host_name, command, state,
       CONVERT(varchar(24), CASE WHEN total_elapsed_time >= 0 THEN total_elapsed_time END) AS elapsed_ms,
       DB_NAME(database_id) AS database_name,
       CONVERT(varchar(19), last_request_end_time, 120) AS last_request_end,
       CONVERT(varchar(1), CASE WHEN database_id = DB_ID() THEN 1 ELSE 0 END) AS selected_row,
       CONVERT(varchar(24), COUNT_BIG(*) OVER ()) AS instance_count,
       CONVERT(varchar(24), COUNT_BIG(CASE WHEN database_id = DB_ID() THEN 1 END) OVER ()) AS database_count
FROM visible
ORDER BY idle, total_elapsed_time DESC, last_request_end_time DESC, session_id
