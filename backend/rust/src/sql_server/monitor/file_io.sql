SELECT CONVERT(varchar(32), SUM(num_of_bytes_read)) AS bytes_read,
       CONVERT(varchar(32), SUM(num_of_bytes_written)) AS bytes_written
FROM sys.dm_io_virtual_file_stats(DB_ID(), NULL)
