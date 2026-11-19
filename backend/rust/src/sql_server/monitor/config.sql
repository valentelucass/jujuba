SELECT CONVERT(varchar(24), CONVERT(bigint, value_in_use)) AS cap_mib
FROM sys.configurations WHERE name = 'max server memory (MB)'
