SELECT CONVERT(varchar(32), physical_memory_in_use_kb * 1024) AS resident,
       process_physical_memory_low AS low_memory
FROM sys.dm_os_process_memory
