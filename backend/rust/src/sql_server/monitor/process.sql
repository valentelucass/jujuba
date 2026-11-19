SELECT CONVERT(varchar(32), physical_memory_in_use_kb * 1024) AS resident
FROM sys.dm_os_process_memory
