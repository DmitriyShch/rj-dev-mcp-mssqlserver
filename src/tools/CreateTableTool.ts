import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";

export class CreateTableTool implements Tool {
  [key: string]: any;
  name = "create_table";
  description = "Creates a new table in the MSSQL Database with the specified columns. Supports partitioned tables when partition scheme is specified.";
  inputSchema = {
    type: "object",
    properties: {
      tableName: { 
        type: "string", 
        description: "Name of the table to create" 
      },
      columns: {
        type: "array",
        description: "Array of column definitions (e.g., [{ name: 'id', type: 'INT PRIMARY KEY' }, ...])",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Column name" },
            type: { type: "string", description: "SQL type and constraints (e.g., 'INT PRIMARY KEY', 'NVARCHAR(255) NOT NULL')" }
          },
          required: ["name", "type"]
        }
      },
      partitionScheme: {
        type: "string",
        description: "Optional: Name of the partition scheme to use for partitioned table (e.g., 'ps_PostHistory_Quarterly')"
      },
      partitionColumn: {
        type: "string", 
        description: "Optional: Column name to partition on (required if partitionScheme is specified, e.g., 'CreationDate')"
      },
      filegroup: {
        type: "string",
        description: "Optional: Filegroup to create table on (for non-partitioned tables, e.g., 'PRIMARY')"
      }
    },
    required: ["tableName", "columns"],
  } as any;

  async run(params: any) {
    try {
      const { tableName, columns, partitionScheme, partitionColumn, filegroup } = params;
      
      // Validation
      if (!Array.isArray(columns) || columns.length === 0) {
        throw new Error("'columns' must be a non-empty array");
      }
      
      if (partitionScheme && !partitionColumn) {
        throw new Error("'partitionColumn' is required when 'partitionScheme' is specified");
      }
      
      if (partitionColumn && !partitionScheme) {
        throw new Error("'partitionScheme' is required when 'partitionColumn' is specified");
      }

      // Build column definitions
      const columnDefs = columns.map((col: any) => `[${col.name}] ${col.type}`).join(", ");
      
      // Build base query
      let query = `CREATE TABLE [${tableName}] (${columnDefs})`;
      
      // Add partition or filegroup clause
      if (partitionScheme && partitionColumn) {
        // Partitioned table
        query += ` ON [${partitionScheme}]([${partitionColumn}])`;
      } else if (filegroup) {
        // Non-partitioned table on specific filegroup
        query += ` ON [${filegroup}]`;
      }
      
      console.log(`Executing: ${query}`);
      
      await new sql.Request().query(query);
      
      // Build success message
      let message = `Table '${tableName}' created successfully`;
      if (partitionScheme) {
        message += ` with partitioning on scheme '${partitionScheme}' using column '${partitionColumn}'`;
      } else if (filegroup) {
        message += ` on filegroup '${filegroup}'`;
      }
      message += ".";
      
      return {
        success: true,
        message: message,
        details: {
          tableName,
          columnCount: columns.length,
          isPartitioned: !!partitionScheme,
          partitionScheme: partitionScheme || null,
          partitionColumn: partitionColumn || null,
          filegroup: filegroup || null
        }
      };
    } catch (error) {
      console.error("Error creating table:", error);
      return {
        success: false,
        message: `Failed to create table: ${error}`,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}