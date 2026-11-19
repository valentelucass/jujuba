SELECT CONVERT(varchar(32), available_physical_memory_kb * 1024) AS available
FROM sys.dm_os_sys_memory
