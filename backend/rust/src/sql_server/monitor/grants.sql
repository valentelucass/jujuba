SELECT CONVERT(varchar(24),SUM(CONVERT(bigint,waiter_count))) AS waiting,
       CONVERT(varchar(32),SUM(granted_memory_kb) * 1024) AS granted,
       CONVERT(varchar(32),SUM(timeout_error_count)) AS timeouts
FROM sys.dm_exec_query_resource_semaphores
