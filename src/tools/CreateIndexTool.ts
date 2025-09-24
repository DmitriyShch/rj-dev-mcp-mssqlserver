import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";

export class CreateIndexTool implements Tool {
  [key: string]: any;
  name = "create_index";
  description = "Creates an index on a specified column or columns in an MSSQL Database table. Supports partitioned indexes when partition scheme is specified.";
  inputSchema = {
    type: "object",
    properties: {
      schemaName: { type: "string", description: "Name of the schema containing the table" },
      tableName: { type: "string", description: "Name of the table to create index on" },
      indexName: { type: "string", description: "Name for the new index" },
      columns: {
        type: "array",
        items: { type: "string" },
        description: "Array of column names to include in the index"
      },
      isUnique: {
        type: "boolean",
        description: "Whether the index should enforce uniqueness (default: false)",
        default: false
      },
      isClustered: {
        type: "boolean",
        description: "Whether the index should be clustered (default: false)",
        default: false
      },
      partitionScheme: {
        type: "string",
        description: "Optional: Name of the partition scheme for partitioned index (e.g., 'ps_PostHistory_Quarterly')"
      },
      partitionColumn: {
        type: "string",
        description: "Optional: Column name to partition index on (required if partitionScheme is specified)"
      },
      filegroup: {
        type: "string",
        description: "Optional: Filegroup to create index on (for non-partitioned indexes, e.g., 'PRIMARY')"
      },
      includedColumns: {
        type: "array",
        items: { type: "string" },
        description: "Optional: Array of column names to include as non-key columns"
      },
      whereClause: {
        type: "string",
        description: "Optional: WHERE clause for filtered index"
      }
    },
    required: ["tableName", "indexName", "columns"],
  } as any;

  async run(params: any) {
    try {
      const {
        schemaName,
        tableName,
        indexName,
        columns,
        isUnique = false,
        isClustered = false,
        partitionScheme,
        partitionColumn,
        filegroup,
        includedColumns,
        whereClause
      } = params;

      // Validation
      if (partitionScheme && !partitionColumn) {
        throw new Error("'partitionColumn' is required when 'partitionScheme' is specified");
      }

      if (partitionColumn && !partitionScheme) {
        throw new Error("'partitionScheme' is required when 'partitionColumn' is specified");
      }

      // Build index type
      let indexType = isClustered ? "CLUSTERED" : "NONCLUSTERED";
      if (isUnique) {
        indexType = `UNIQUE ${indexType}`;
      }

      // Build column names
      const columnNames = columns.join(", ");

      // Build query
      const request = new sql.Request();
      let query = `CREATE ${indexType} INDEX ${indexName} ON ${schemaName || 'dbo'}.${tableName} (${columnNames})`;

      // Add included columns if specified
      if (includedColumns && includedColumns.length > 0) {
        const includeCols = includedColumns.join(", ");
        query += ` INCLUDE (${includeCols})`;
      }

      // Add WHERE clause if specified
      if (whereClause) {
        query += ` WHERE ${whereClause}`;
      }

      // Add partition or filegroup clause
      if (partitionScheme && partitionColumn) {
        // Partitioned index
        query += ` ON [${partitionScheme}]([${partitionColumn}])`;
      } else if (filegroup) {
        // Non-partitioned index on specific filegroup
        query += ` ON [${filegroup}]`;
      }

      console.log(`Executing: ${query}`);

      await request.query(query);

      // Build success message
      let message = `Index [${indexName}] created successfully on table [${schemaName || 'dbo'}.${tableName}]`;
      if (partitionScheme && partitionColumn) {
        message += ` with partitioning on scheme '${partitionScheme}' using column '${partitionColumn}'`;
      } else if (filegroup) {
        message += ` on filegroup '${filegroup}'`;
      }

      return {
        success: true,
        message: message,
        details: {
          schemaName: schemaName || 'dbo',
          tableName,
          indexName,
          columnNames,
          isUnique,
          isClustered,
          isPartitioned: !!(partitionScheme && partitionColumn),
          partitionScheme: partitionScheme || null,
          partitionColumn: partitionColumn || null,
          filegroup: filegroup || null,
          includedColumns: includedColumns || null,
          hasWhereClause: !!whereClause
        }
      };
    } catch (error) {
      console.error("Error creating index:", error);
      return {
        success: false,
        message: `Failed to create index: ${error}`,
      };
    }
  }
}