SELECT CONVERT(varchar(32), waiting_tasks_count) AS waits,
       CONVERT(varchar(32), wait_time_ms) AS wait_ms
FROM sys.dm_os_wait_stats WHERE wait_type = N'RESOURCE_SEMAPHORE'
