import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";

export class DBA_InsertDataTool implements Tool {
  [key: string]: any;
  name = "DBA_insert_data";  // ← Changed from "simple_bulk_migration"
  description = `Simple tool for bulk table-to-table data migration using INSERT...SELECT.

FORMAT:
{
  "sourceTable": "PostHistory_Backup",
  "targetTable": "PostHistory", 
  "rowLimit": 10000,
  "columns": ["Id", "PostHistoryTypeId", "PostId", "RevisionGUID", "CreationDate", "UserId", "UserDisplayName", "Comment", "Text"]
}

This generates: INSERT INTO PostHistory SELECT TOP(10000) * FROM PostHistory_Backup ORDER BY Id`;

  inputSchema = {
    type: "object",
    properties: {
      sourceTable: { 
        type: "string", 
        description: "Source table name (e.g., 'PostHistory_Backup')" 
      },
      targetTable: { 
        type: "string", 
        description: "Target table name (e.g., 'PostHistory')" 
      },
      rowLimit: { 
        type: "number", 
        description: "Maximum number of rows to migrate (optional)" 
      },
      columns: { 
        type: "array", 
        items: { type: "string" },
        description: "Specific columns to migrate (optional, defaults to all columns)" 
      },
      whereClause: { 
        type: "string", 
        description: "Optional WHERE clause for filtering source data" 
      },
      orderBy: { 
        type: "string", 
        description: "Optional ORDER BY clause (defaults to 'Id')" 
      }
    },
    required: ["sourceTable", "targetTable"]
  } as any;

  async run(params: any) {
    const startTime = performance.now();
    
    try {
      const { 
        sourceTable, 
        targetTable, 
        rowLimit, 
        columns, 
        whereClause, 
        orderBy = "Id" 
      } = params;

      console.log('🚀 DBA Insert Data Tool started:', {
        sourceTable,
        targetTable,
        rowLimit: rowLimit || 'No limit',
        timestamp: new Date().toISOString()
      });

      // Build column list
      const columnList = columns && Array.isArray(columns) && columns.length > 0 
        ? columns.join(', ') 
        : '*';

      // Build query components
      const topClause = rowLimit ? `TOP (${rowLimit}) ` : '';
      const whereClauseSQL = whereClause ? `\nWHERE ${whereClause}` : '';
      const orderBySQL = orderBy ? `\nORDER BY ${orderBy}` : '';

      // Build the complete SQL query
      const query = `
SET NOCOUNT ON;
PRINT 'Starting bulk migration from ${sourceTable} to ${targetTable} at: ' + CONVERT(varchar, GETDATE(), 120);

INSERT INTO ${targetTable} WITH (TABLOCK)
SELECT ${topClause}${columnList}
FROM ${sourceTable}${whereClauseSQL}${orderBySQL};

PRINT 'Migration completed at: ' + CONVERT(varchar, GETDATE(), 120);
PRINT 'Rows migrated: ' + CAST(@@ROWCOUNT AS varchar(20));
`.trim();

      console.log('📝 Generated SQL query:');
      console.log(query);

      // Execute the migration
      const request = new sql.Request();
      (request as any).requestTimeout = 600000; // 10 minutes
      
      console.log('⏱️ Executing bulk migration...');
      const migrationStartTime = performance.now();
      
      const result = await request.query(query);
      
      const migrationEndTime = performance.now();
      const migrationDuration = migrationEndTime - migrationStartTime;
      const totalDuration = migrationEndTime - startTime;

      const rowsAffected = result.rowsAffected && result.rowsAffected.length > 0 
        ? result.rowsAffected[0] 
        : 'Unknown';

      console.log('✅ Bulk migration completed successfully');

      return {
        success: true,
        message: `Successfully migrated ${rowsAffected} rows from ${sourceTable} to ${targetTable}`,
        recordsMigrated: rowsAffected,
        sourceTable,
        targetTable,
        migrationDuration: `${migrationDuration.toFixed(2)}ms`,
        totalDuration: `${totalDuration.toFixed(2)}ms`,
        performanceRate: rowsAffected !== 'Unknown' && rowsAffected > 0 ? 
          `${Math.round(rowsAffected / (migrationDuration / 1000))} rows/second` : 'Unknown',
        timestamp: new Date().toISOString(),
        query: query
      };

    } catch (error) {
      const duration = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      console.error("❌ DBA Insert Data Tool failed:", errorMessage);
      
      return {
        success: false,
        message: `Bulk migration failed: ${errorMessage}`,
        error: errorMessage,
        duration: `${duration.toFixed(2)}ms`,
        timestamp: new Date().toISOString()
      };
    }
  }
}