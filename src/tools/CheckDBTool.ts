import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";

export class CheckDBTool implements Tool {
  [key: string]: any;
  name = "check_db";
  description = "Runs DBCC CHECKDB on a specified database to check for consistency errors";

  inputSchema = {
    type: "object",
    properties: {
      databaseName: {
        type: "string",
        description: "The name of the database to check"
      }
    },
    required: ["databaseName"]
  } as any;

  async run(params: any) {
    const { databaseName } = params;

    try {
      // Safely quote the database name to prevent injection
      const safeDbName = `[${databaseName.replace(/[\[\]]/g, "")}]`;
      const request = new sql.Request();
      
      // Capture messages/info output from DBCC CHECKDB
      let messages: string[] = [];
      let hasErrors = false;
      
      // Handle info messages (most DBCC output comes through here)
      request.on('info', (info) => {
        if (info && info.message) {
          messages.push(info.message);
          // DBCC CHECKDB error messages typically contain these keywords
          if (info.message.toLowerCase().includes('error') || 
              info.message.toLowerCase().includes('corrupt') ||
              info.message.toLowerCase().includes('inconsistent') ||
              info.message.toLowerCase().includes('allocation') ||
              info.message.toLowerCase().includes('repair')) {
            hasErrors = true;
          }
        }
      });

      // Handle error messages
      request.on('error', (err) => {
        if (err && err.message) {
          messages.push(`ERROR: ${err.message}`);
          hasErrors = true;
        }
      });

      const query = `DBCC CHECKDB(${safeDbName}) WITH NO_INFOMSGS, ALL_ERRORMSGS`;
      
      const result = await request.query(query);

      // DBCC CHECKDB may return recordsets in case of corruption details
      let errorDetails: any[] = [];
      
      // Safe check for recordsets existence and length
      if (result && result.recordsets && Array.isArray(result.recordsets) && result.recordsets.length > 0) {
        // Process each recordset
        for (const recordset of result.recordsets) {
          if (recordset && Array.isArray(recordset) && recordset.length > 0) {
            errorDetails.push(...recordset);
            hasErrors = true;
          }
        }
      }

      // If no messages were captured but we have a successful result, add a success message
      if (messages.length === 0 && !hasErrors) {
        messages.push(`CHECKDB found 0 allocation errors and 0 consistency errors in database '${databaseName}'.`);
      }

      return {
        success: true,
        message: `DBCC CHECKDB completed for database [${databaseName}]`,
        errorsFound: hasErrors,
        messages: messages,
        errorDetails: errorDetails,
        summary: hasErrors 
          ? `Consistency errors found in database [${databaseName}]. Check messages and errorDetails for specifics.`
          : `Database [${databaseName}] passed consistency checks - no corruption detected.`,
        totalMessages: messages.length,
        totalErrorRecords: errorDetails.length
      };
    } catch (error) {
      // Enhanced error handling
      if (error instanceof Error) {
        return {
          success: false,
          message: `Failed to check database: ${error.message}`,
          error: error.name,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        };
      } else {
        return {
          success: false,
          message: `Failed to check database: ${String(error)}`,
        };
      }
    }
  }
}