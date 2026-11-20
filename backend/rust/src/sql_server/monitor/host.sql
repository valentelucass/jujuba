SELECT CONVERT(varchar(32), available_physical_memory_kb * 1024) AS available,
       system_low_memory_signal_state AS low_memory
FROM sys.dm_os_sys_memory
