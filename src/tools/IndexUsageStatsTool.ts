import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";

export class IndexUsageStatsTool implements Tool {
  [key: string]: any;
  name = "index_usage_stats";
  description = "Analyze unused, missing, and duplicate indexes";

  inputSchema: {
    type: "object";
    properties: {};
    required: string[];
  } = {
    type: "object",
    properties: {},
    required: []
  };

  async run(_: any) {
    const query = `
    -- Comprehensive Index Usage and Storage Analysis (API-Compatible Version)
   SELECT 
    s.name AS SchemaName,
    OBJECT_NAME(ix.OBJECT_ID) AS TableName,
    ix.name AS IndexName,
    ix.type_desc AS IndexType,
    ix.is_primary_key AS IsPrimaryKey,
    ix.is_unique AS IsUnique,
    ix.fill_factor AS [FillFactor],
    fg.name AS FileGroupName,
    
    -- Storage Information
    p.rows AS [RowCount],
    CAST(ROUND((SUM(a.total_pages) / 128.00), 2) AS NUMERIC(36, 2)) AS TotalSizeMB,
    CAST(ROUND((SUM(a.used_pages) / 128.00), 2) AS NUMERIC(36, 2)) AS UsedSizeMB,
    CAST(ROUND((SUM(a.total_pages) - SUM(a.used_pages)) / 128.00, 2) AS NUMERIC(36, 2)) AS UnusedSizeMB,
    
    -- Usage Statistics
    ISNULL(ixus.user_seeks, 0) AS UserSeeks,
    ISNULL(ixus.user_scans, 0) AS UserScans,
    ISNULL(ixus.user_lookups, 0) AS UserLookups,
    ISNULL(ixus.user_updates, 0) AS UserUpdates,
    
    -- Total Read Operations
    ISNULL(ixus.user_seeks, 0) + ISNULL(ixus.user_scans, 0) + ISNULL(ixus.user_lookups, 0) AS TotalReads,
    
    -- Last Usage Dates
    ixus.last_user_seek AS LastUserSeek,
    ixus.last_user_scan AS LastUserScan,
    ixus.last_user_lookup AS LastUserLookup,
    ixus.last_user_update AS LastUserUpdate,
    
    -- Analysis Flags
    CASE 
        WHEN ixus.user_seeks IS NULL AND ixus.user_scans IS NULL AND ixus.user_lookups IS NULL 
        THEN 'UNUSED'
        WHEN (ISNULL(ixus.user_seeks, 0) + ISNULL(ixus.user_scans, 0) + ISNULL(ixus.user_lookups, 0)) = 0 
        THEN 'NO_READS'
        WHEN ISNULL(ixus.user_updates, 0) > (ISNULL(ixus.user_seeks, 0) + ISNULL(ixus.user_scans, 0) + ISNULL(ixus.user_lookups, 0)) * 10
        THEN 'UPDATE_HEAVY'
        WHEN CAST(ROUND((SUM(a.total_pages) / 128.00), 2) AS NUMERIC(36, 2)) > 100 
             AND (ISNULL(ixus.user_seeks, 0) + ISNULL(ixus.user_scans, 0) + ISNULL(ixus.user_lookups, 0)) < 10
        THEN 'LARGE_UNUSED'
        ELSE 'ACTIVE'
    END AS IndexStatus,
    
    -- Read vs Write Ratio
    CASE 
        WHEN ISNULL(ixus.user_updates, 0) = 0 THEN 'READ_only'
        WHEN (ISNULL(ixus.user_seeks, 0) + ISNULL(ixus.user_scans, 0) + ISNULL(ixus.user_lookups, 0)) = 0 THEN 'write_only'
        ELSE CAST(ROUND(
            CAST(ISNULL(ixus.user_seeks, 0) + ISNULL(ixus.user_scans, 0) + ISNULL(ixus.user_lookups, 0) AS FLOAT) / 
            CAST(ISNULL(ixus.user_updates, 0) AS FLOAT), 2
        ) AS VARCHAR(20)) + ':1'
    END AS ReadWriteRatio

FROM sys.indexes ix
INNER JOIN sys.tables t ON ix.object_id = t.object_id
INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
INNER JOIN sys.partitions p ON ix.object_id = p.object_id AND ix.index_id = p.index_id
INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id
INNER JOIN sys.filegroups fg ON fg.data_space_id = ix.data_space_id
LEFT JOIN sys.dm_db_index_usage_stats ixus ON ixus.index_id = ix.index_id 
    AND ixus.object_id = ix.object_id 
    AND ixus.database_id = DB_ID()

WHERE OBJECTPROPERTY(ix.OBJECT_ID, 'IsUserTable') = 1
    AND ix.type IN (1, 2) -- Clustered and Non-Clustered indexes only

GROUP BY 
    s.name,
    OBJECT_NAME(ix.OBJECT_ID),
    ix.name,
    ix.type_desc,
    ix.is_primary_key,
    ix.is_unique,
    ix.fill_factor,
    fg.name,
    p.rows,
    ixus.user_seeks,
    ixus.user_scans,
    ixus.user_lookups,
    ixus.user_updates,
    ixus.last_user_seek,
    ixus.last_user_scan,
    ixus.last_user_lookup,
    ixus.last_user_update

ORDER BY 
    s.name,
    OBJECT_NAME(ix.OBJECT_ID),
    CAST(ROUND((SUM(a.total_pages) / 128.00), 2) AS NUMERIC(36, 2)) DESC,
    ix.name; `;
        
    try {
      const request = new sql.Request();
      const result = await request.query(query);
      
      // Handle the recordsets properly - fix TypeScript type issue
      if (result.recordsets && Array.isArray(result.recordsets) && result.recordsets.length > 0) {
        return {
          success: true,
          message: "Index usage + size stats retrieved",
          data: result.recordsets[0], // Return first recordset
          recordCount: result.recordsets[0].length,
          totalRecordsets: result.recordsets.length
        };
      } else {
        return {
          success: true,
          message: "Query executed but no data returned",
          data: [],
          recordCount: 0
        };
      }
    } catch (err: any) {
      return {
        success: false,
        message: `Failed to retrieve index usage stats: ${err.message}`,
        error: err.name || 'UNKNOWN_ERROR',
        sqlError: err.originalError ? err.originalError.info : undefined
      };
    }
  }
}