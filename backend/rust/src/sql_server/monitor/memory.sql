SELECT CONVERT(varchar(32), committed_kb * 1024) AS committed,
CONVERT(varchar(32), committed_target_kb * 1024) AS target FROM sys.dm_os_sys_info
