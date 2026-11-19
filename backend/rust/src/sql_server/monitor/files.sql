SELECT
CONVERT(varchar(32), SUM(CONVERT(bigint,size)) * 8192) AS allocated,
CONVERT(varchar(32), CASE WHEN COUNT_BIG(FILEPROPERTY(name,'SpaceUsed')) = COUNT_BIG(*)
    THEN SUM(CONVERT(bigint,size) - FILEPROPERTY(name,'SpaceUsed')) * 8192 END) AS free_space
FROM sys.database_files WHERE type=0 AND state=0
