import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";

export class sp_BlitzTool implements Tool {
  [key: string]: any;
  name = "sp_blitz";
  description = "Executes sp_Blitz to perform SQL Server health checks and identify potential performance issues";

  inputSchema = {
    type: "object",
    properties: {
      Help: {
        type: "boolean",
        description: "Show help information for sp_Blitz (default: false)"
      },
      CheckUserDatabaseObjects: {
        type: "boolean",
        description: "Check user database objects for common issues (default: true)"
      },
      CheckProcedureCache: {
        type: "boolean", 
        description: "Check procedure cache for performance issues (default: true)"
      },
      OutputType: {
        type: "string",
        description: "Output format for results (default: TABLE)",
        enum: ["TABLE", "COUNT", "MARKDOWN", "XML"]
      },
      OutputProcedureCache: {
        type: "boolean",
        description: "Output procedure cache information (default: false)"
      },
      CheckServerInfo: {
        type: "boolean",
        description: "Include server configuration information (default: true)"
      },
      SkipChecksServer: {
        type: "string",
        description: "Server name pattern to skip during checks"
      },
      SkipChecksDatabase: {
        type: "string",
        description: "Database name pattern to skip during checks"
      },
      SkipChecksSchema: {
        type: "string", 
        description: "Schema name pattern to skip during checks"
      },
      SkipChecksTable: {
        type: "string",
        description: "Table name pattern to skip during checks"
      },
      IgnorePrioritiesBelow: {
        type: "integer",
        description: "Ignore findings with priority below this number (1-255)"
      },
      IgnorePrioritiesAbove: {
        type: "integer", 
        description: "Ignore findings with priority above this number (1-255)"
      },
      OutputServerName: {
        type: "string",
        description: "Server name to include in output"
      },
      OutputDatabaseName: {
        type: "string",
        description: "Database name for output table (if saving results)"
      },
      OutputSchemaName: {
        type: "string",
        description: "Schema name for output table (if saving results)"
      },
      OutputTableName: {
        type: "string",
        description: "Table name for saving results"
      },
      OutputXMLasNVARCHAR: {
        type: "boolean",
        description: "Output XML results as NVARCHAR (default: false)"
      },
      EmailRecipients: {
        type: "string",
        description: "Email recipients for results (requires Database Mail)"
      },
      EmailProfile: {
        type: "string",
        description: "Database Mail profile name for sending email"
      },
      SummaryMode: {
        type: "boolean",
        description: "Show only summary of findings (default: false)"
      },
      BringThePain: {
        type: "boolean",
        description: "Run more intensive checks that may impact performance (default: false)"
      },
      SkipBlockingChecks: {
        type: "boolean",
        description: "Skip blocking-related checks (default: false)"
      },
      Debug: {
        type: "boolean",
        description: "Enable debug mode for troubleshooting (default: false)"
      },
      VersionDate: {
        type: "string",
        description: "Version date for sp_Blitz (Input/Output parameter)"
      },
      VersionCheckMode: {
        type: "boolean",
        description: "Enable version check mode (default: false)"
      }
    },
    required: []
  } as any;

  async run(params: any) {
    const {
      Help = false,
      CheckUserDatabaseObjects = true,
      CheckProcedureCache = true,
      OutputType = "TABLE",
      OutputProcedureCache = false,
      CheckServerInfo = true,
      SkipChecksServer,
      SkipChecksDatabase,
      SkipChecksSchema,
      SkipChecksTable,
      IgnorePrioritiesBelow,
      IgnorePrioritiesAbove,
      OutputServerName,
      OutputDatabaseName,
      OutputSchemaName,
      OutputTableName,
      OutputXMLasNVARCHAR = false,
      EmailRecipients,
      EmailProfile,
      SummaryMode = false,
      BringThePain = false,
      SkipBlockingChecks = false,
      Debug = false,
      VersionDate,
      VersionCheckMode = false
    } = params;

    try {
      const request = new sql.Request();
      
      // Use exact parameters from your sp_Blitz stored procedure
      const supportedParams: string[] = [
        "Help",
        "CheckUserDatabaseObjects", 
        "CheckProcedureCache",
        "OutputType",
        "OutputProcedureCache",
        "CheckServerInfo",
        "SkipChecksServer",
        "SkipChecksDatabase", 
        "SkipChecksSchema",
        "SkipChecksTable",
        "IgnorePrioritiesBelow", 
        "IgnorePrioritiesAbove",
        "OutputServerName",
        "OutputDatabaseName",
        "OutputSchemaName", 
        "OutputTableName",
        "OutputXMLasNVARCHAR",
        "EmailRecipients",
        "EmailProfile",
        "SummaryMode",
        "BringThePain",
        "SkipBlockingChecks",
        "Debug",
        "VersionDate",
        "VersionCheckMode"
      ];

      // Build the sp_Blitz command with only supported parameters
      let query = "EXEC sp_Blitz";
      const queryParams: string[] = [];

      const addParam = (paramName: string, value: any, isString = false) => {
        if (value !== undefined && value !== null && supportedParams.includes(paramName)) {
          if (isString) {
            queryParams.push(`@${paramName} = '${value.toString().replace(/'/g, "''")}'`);
          } else if (typeof value === 'boolean') {
            queryParams.push(`@${paramName} = ${value ? 1 : 0}`);
          } else {
            queryParams.push(`@${paramName} = ${value}`);
          }
        }
      };

      // Add all supported parameters
      addParam("Help", Help);
      addParam("CheckUserDatabaseObjects", CheckUserDatabaseObjects);
      addParam("CheckProcedureCache", CheckProcedureCache);
      addParam("OutputType", OutputType, true);
      addParam("OutputProcedureCache", OutputProcedureCache);
      addParam("CheckServerInfo", CheckServerInfo);
      addParam("SkipChecksServer", SkipChecksServer, true);
      addParam("SkipChecksDatabase", SkipChecksDatabase, true);
      addParam("SkipChecksSchema", SkipChecksSchema, true);
      addParam("SkipChecksTable", SkipChecksTable, true);
      addParam("IgnorePrioritiesBelow", IgnorePrioritiesBelow);
      addParam("IgnorePrioritiesAbove", IgnorePrioritiesAbove);
      addParam("OutputServerName", OutputServerName, true);
      addParam("OutputDatabaseName", OutputDatabaseName, true);
      addParam("OutputSchemaName", OutputSchemaName, true);
      addParam("OutputTableName", OutputTableName, true);
      addParam("OutputXMLasNVARCHAR", OutputXMLasNVARCHAR);
      addParam("EmailRecipients", EmailRecipients, true);
      addParam("EmailProfile", EmailProfile, true);
      addParam("SummaryMode", SummaryMode);
      addParam("BringThePain", BringThePain);
      addParam("SkipBlockingChecks", SkipBlockingChecks);
      addParam("Debug", Debug);
      addParam("VersionDate", VersionDate, true);
      addParam("VersionCheckMode", VersionCheckMode);

      // Add parameters to query if any exist
      if (queryParams.length > 0) {
        query += " " + queryParams.join(", ");
      }

      // Execute the main sp_Blitz query
      const mainRequest = new sql.Request();
      const result = await mainRequest.query(query);

      const findings = result.recordset || [];
      const totalFindings = findings.length;
      const criticalFindings = findings.filter((f: any) => f.Priority && f.Priority <= 50).length;
      const warningFindings = findings.filter((f: any) => f.Priority && f.Priority > 50 && f.Priority <= 100).length;
      const infoFindings = findings.filter((f: any) => f.Priority && f.Priority > 100).length;

      // Group findings by CheckID for better organization
      const findingsByCheck: { [key: string]: any } = {};
      findings.forEach((finding: any) => {
        const checkId = finding.CheckID || 'Unknown';
        if (!findingsByCheck[checkId]) {
          findingsByCheck[checkId] = {
            CheckID: checkId,
            FindingsGroup: finding.FindingsGroup || 'Unknown',
            Finding: finding.Finding || 'No description',
            Priority: finding.Priority || 999,
            count: 0,
            details: []
          };
        }
        findingsByCheck[checkId].count++;
        findingsByCheck[checkId].details.push(finding);
      });

      const errorsFound = criticalFindings > 0 || warningFindings > 0;

      return {
        success: true,
        message: `sp_Blitz executed successfully with ${queryParams.length} parameters. Found ${totalFindings} finding(s)` +
          (criticalFindings > 0 || warningFindings > 0 ? 
            ` (${criticalFindings} critical, ${warningFindings} warnings, ${infoFindings} informational)` : 
            totalFindings > 0 ? ` (${infoFindings} informational)` : ""),
        errorsFound,
        parametersUsed: queryParams.length,
        actualQuery: query,
        details: {
          totalFindings,
          criticalFindings,
          warningFindings,
          infoFindings,
          findingsByCheck: Object.values(findingsByCheck),
          allFindings: findings
        }
      };
    } catch (error) {
      if (error instanceof Error) {
        // Handle specific parameter errors more gracefully
        if (error.message.includes("is not a parameter for procedure")) {
          return {
            success: false,
            message: `Parameter compatibility issue: ${error.message}. Try running with fewer parameters or check sp_Blitz version.`,
            suggestion: "Try running sp_Blitz with only basic parameters like CheckServerInfo=true"
          };
        }
        
        return {
          success: false,
          message: `Failed to execute sp_Blitz: ${error.message}`,
        };
      } else {
        return {
          success: false,
          message: `Failed to execute sp_Blitz: ${String(error)}`,
        };
      }
    }
  }
}