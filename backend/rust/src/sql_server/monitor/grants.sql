SELECT CONVERT(varchar(24),SUM(CONVERT(bigint,waiter_count))) AS waiting
FROM sys.dm_exec_query_resource_semaphores
