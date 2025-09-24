import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";

export class DBA_ReadDataTool implements Tool {
  [key: string]: any;
  name = "DBA_read_data";
  description = "Enhanced DBA tool for executing diagnostic SELECT queries with performance monitoring capabilities. Supports SET STATISTICS IO/TIME, SHOWPLAN, DBCC commands, and other DBA diagnostic operations for performance troubleshooting.";
  
  inputSchema = {
    type: "object",
    properties: {
      query: { 
        type: "string", 
        description: "SQL query or batch for DBA diagnostics. Supports SELECT, SET STATISTICS, SHOWPLAN, DBCC diagnostics. Example: 'SET STATISTICS IO ON; SELECT * FROM Posts WHERE Id = 1; SET STATISTICS IO OFF;'" 
      },
      captureExecutionPlan: {
        type: "boolean",
        description: "Whether to capture execution plan information (default: false)",
        default: false
      },
      captureStatistics: {
        type: "boolean", 
        description: "Whether to automatically enable IO and TIME statistics (default: true)",
        default: true
      },
      showplanType: {
        type: "string",
        description: "Type of execution plan to capture: 'XML', 'ALL', 'TEXT' (default: 'XML')",
        default: "XML",
        enum: ["XML", "ALL", "TEXT"]
      }
    },
    required: ["query"],
  } as any;

  // Allowed DBA diagnostic keywords and commands
  private static readonly ALLOWED_DBA_KEYWORDS = [
    // SET commands for diagnostics
    'SET', 'STATISTICS', 'IO', 'TIME', 'SHOWPLAN_ALL', 'SHOWPLAN_TEXT', 
    'SHOWPLAN_XML', 'NOCOUNT', 'ANSI_NULLS', 'ANSI_WARNINGS',
    
    // DBCC diagnostic commands (read-only)
    'DBCC', 'SHOW_STATISTICS', 'INPUTBUFFER', 'OUTPUTBUFFER', 'PROCCACHE',
    'TRACESTATUS', 'FREESESSIONCACHE', 'FREEPROCCACHE', 'DROPCLEANBUFFERS',
    
    // Performance monitoring
    'CHECKPOINT', 'WAITFOR'
  ];

  // Still dangerous keywords that should never be allowed
  private static readonly DANGEROUS_KEYWORDS = [
    'DELETE', 'DROP', 'UPDATE', 'INSERT', 'ALTER', 'CREATE', 
    'TRUNCATE', 'MERGE', 'REPLACE', 'GRANT', 'REVOKE', 
    'BACKUP', 'RESTORE', 'KILL', 'SHUTDOWN',
    'OPENROWSET', 'OPENDATASOURCE', 'OPENQUERY', 'OPENXML', 'BULK',
    // Exclude some DBCC commands that modify data
    'DBCC CHECKDB', 'DBCC CHECKALLOC', 'DBCC CHECKTABLE', 'DBCC CHECKFILEGROUP'
  ];

  // Regex patterns for dangerous operations (more permissive than ReadDataTool)
  private static readonly DANGEROUS_PATTERNS = [
    // Data modification through DBCC
    /DBCC\s+(CHECKDB|CHECKALLOC|CHECKTABLE|CHECKFILEGROUP|WRITEPAGE|PAGE)/i,
    
    // System modification
    /EXEC\s+sp_configure/i,
    /EXEC\s+xp_/i,
    
    // Bulk operations
    /BULK\s+INSERT/i,
    /OPENROWSET/i,
    /OPENDATASOURCE/i,
    
    // File system access
    /xp_cmdshell/i,
    /xp_dirtree/i,
    /xp_fileexist/i,
    
    // Security functions (be more permissive with diagnostic functions)
    /PASSWORD/i,
    /LOGIN/i,
  ];

  /**
   * Validates the SQL batch for DBA diagnostic operations
   * @param query The SQL batch to validate
   * @returns Validation result with success flag and error message if invalid
   */
  private validateDBAQuery(query: string): { isValid: boolean; error?: string } {
    if (!query || typeof query !== 'string') {
      return { 
        isValid: false, 
        error: 'Query must be a non-empty string' 
      };
    }

    // Remove comments and normalize whitespace for analysis
    const cleanQuery = query
      .replace(/--.*$/gm, '') // Remove line comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();

    if (!cleanQuery) {
      return { 
        isValid: false, 
        error: 'Query cannot be empty after removing comments' 
      };
    }

    const upperQuery = cleanQuery.toUpperCase();

    // Check for strictly dangerous keywords
    for (const keyword of DBA_ReadDataTool.DANGEROUS_KEYWORDS) {
      const keywordRegex = new RegExp(`(^|\\s|[^A-Za-z0-9_])${keyword}($|\\s|[^A-Za-z0-9_])`, 'i');
      if (keywordRegex.test(upperQuery)) {
        return { 
          isValid: false, 
          error: `Dangerous keyword '${keyword}' detected. This DBA tool prohibits data modification operations.` 
        };
      }
    }

    // Check for dangerous patterns
    for (const pattern of DBA_ReadDataTool.DANGEROUS_PATTERNS) {
      if (pattern.test(query)) {
        return { 
          isValid: false, 
          error: 'Potentially dangerous operation detected. This tool is for diagnostic queries only.' 
        };
      }
    }

    // Validate that the batch contains at least one SELECT or allowed DBA command
    const hasValidOperation = /SELECT|SET\s+STATISTICS|SET\s+SHOWPLAN|DBCC\s+SHOW_STATISTICS/i.test(upperQuery);
    if (!hasValidOperation) {
      return {
        isValid: false,
        error: 'Batch must contain at least one SELECT statement or valid DBA diagnostic command.'
      };
    }

    // Limit query length to prevent potential DoS
    if (query.length > 50000) {
      return { 
        isValid: false, 
        error: 'Query batch is too long. Maximum allowed length is 50,000 characters.' 
      };
    }

    return { isValid: true };
  }

  /**
   * Checks if the query already contains SHOWPLAN commands
   * @param query The SQL query to check
   * @returns True if SHOWPLAN commands are present
   */
  private hasShowplanCommands(query: string): boolean {
    const upperQuery = query.toUpperCase();
    return /SET\s+SHOWPLAN_(XML|ALL|TEXT)\s+(ON|OFF)/i.test(upperQuery);
  }

  /**
   * Extracts SELECT statements from a batch for execution plan capture
   * @param query The SQL batch
   * @returns Array of SELECT statements
   */
  private extractSelectStatements(query: string): string[] {
    // Simple extraction - split by semicolon and filter SELECT statements
    const statements = query.split(';').map(s => s.trim()).filter(s => s.length > 0);
    return statements.filter(stmt => /^\s*SELECT/i.test(stmt));
  }

  /**
   * Executes a query with execution plan capture
   * @param selectQuery The SELECT query to analyze
   * @param showplanType The type of showplan to use
   * @returns Execution plan information
   */
  private async captureExecutionPlan(selectQuery: string, showplanType: string): Promise<any> {
    try {
      const showplanCommand = `SET SHOWPLAN_${showplanType} ON`;
      const showplanOffCommand = `SET SHOWPLAN_${showplanType} OFF`;
      
      // Execute in separate batches as required by SQL Server
      const request1 = new sql.Request();
      await request1.batch(showplanCommand);
      
      const request2 = new sql.Request();
      const planResult = await request2.batch(selectQuery);
      
      const request3 = new sql.Request();
      await request3.batch(showplanOffCommand);
      
      return {
        showplanType: showplanType,
        executionPlan: planResult.recordset || planResult.recordsets,
        planCaptured: true
      };
    } catch (error) {
      console.warn(`Failed to capture ${showplanType} execution plan:`, error);
      return {
        showplanType: showplanType,
        executionPlan: null,
        planCaptured: false,
        planError: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Captures and formats diagnostic information from SQL Server messages
   * @param request The SQL request object
   * @returns Promise that resolves when info messages are captured
   */
  private setupDiagnosticCapture(request: sql.Request): Promise<string[]> {
    const diagnosticMessages: string[] = [];
    
    return new Promise((resolve) => {
      // Capture info messages (STATISTICS IO, TIME, etc.)
      request.on('info', (info) => {
        if (info.message) {
          diagnosticMessages.push(info.message);
        }
      });

      // Capture error messages that aren't actual errors (like STATISTICS output)
      request.on('error', (err) => {
        if (err.message && !err.message.includes('Could not')) {
          diagnosticMessages.push(`Warning: ${err.message}`);
        }
      });

      // Return the messages array (it will be populated by the event handlers)
      setTimeout(() => resolve(diagnosticMessages), 100);
    });
  }

  /**
   * Executes the validated DBA diagnostic batch
   * @param params Query parameters
   * @returns Query execution result with diagnostic information
   */
  async run(params: any) {
    try {
      const { 
        query, 
        captureExecutionPlan = false, 
        captureStatistics = true,
        showplanType = "XML"
      } = params;
      
      // Validate the query for security issues
      const validation = this.validateDBAQuery(query);
      if (!validation.isValid) {
        console.warn(`DBA tool validation failed for query: ${query.substring(0, 100)}...`);
        return {
          success: false,
          message: `Security validation failed: ${validation.error}`,
          error: 'SECURITY_VALIDATION_FAILED'
        };
      }

      // Log the query for audit purposes
      console.log(`Executing DBA diagnostic batch: ${query.substring(0, 200)}${query.length > 200 ? '...' : ''}`);

      let executionPlanInfo = null;
      
      // Handle execution plan capture separately if requested and no SHOWPLAN already in query
      if (captureExecutionPlan && !this.hasShowplanCommands(query)) {
        const selectStatements = this.extractSelectStatements(query);
        if (selectStatements.length > 0) {
          // Capture execution plan for the first SELECT statement
          executionPlanInfo = await this.captureExecutionPlan(selectStatements[0], showplanType);
        }
      }

      // Prepare the main query batch with optional automatic statistics
      let finalQuery = query;
      
      if (captureStatistics && !query.toUpperCase().includes('SET STATISTICS')) {
        finalQuery = `
SET STATISTICS IO ON;
SET STATISTICS TIME ON;
${query}
SET STATISTICS IO OFF;
SET STATISTICS TIME OFF;`;
      }

      // Create request and setup diagnostic capture
      const request = new sql.Request();
      const diagnosticMessages: string[] = [];
      
      // Capture info messages for statistics (with proper typing)
      request.on('info', (info: any) => {
        if (info && info.message) {
          diagnosticMessages.push(info.message);
        }
      });

      // Execute the main batch (without SHOWPLAN if we captured it separately)
      const startTime = Date.now();
      let result;
      
      if (this.hasShowplanCommands(query)) {
        // Query already has SHOWPLAN commands, execute as-is
        result = await request.batch(finalQuery);
      } else {
        // Execute without SHOWPLAN to avoid batch conflicts
        result = await request.batch(finalQuery);
      }
      
      const executionTime = Date.now() - startTime;
      
      // Process results - batch can return multiple recordsets
      const recordsets = result.recordsets || [];
      
      // Handle both array and object types for recordsets
      let recordsetsArray: any[] = [];
      let totalRecords = 0;
      
      if (Array.isArray(recordsets)) {
        recordsetsArray = recordsets;
        totalRecords = recordsetsArray.reduce((sum: number, rs: any) => {
          return sum + (Array.isArray(rs) ? rs.length : 0);
        }, 0);
      } else if (recordsets && typeof recordsets === 'object') {
        // Convert object to array
        recordsetsArray = Object.values(recordsets);
        totalRecords = recordsetsArray.reduce((sum: number, rs: any) => {
          return sum + (Array.isArray(rs) ? rs.length : 0);
        }, 0);
      }
      
      // Format diagnostic information
      const diagnosticInfo = {
        executionTimeMs: executionTime,
        statisticsMessages: diagnosticMessages.filter(msg => 
          msg.includes('logical reads') || 
          msg.includes('CPU time') || 
          msg.includes('elapsed time') ||
          msg.includes('scan count') ||
          msg.includes('physical reads')
        ),
        warningMessages: diagnosticMessages.filter(msg => 
          !msg.includes('logical reads') && 
          !msg.includes('CPU time') && 
          !msg.includes('elapsed time')
        ),
        recordsetCount: recordsetsArray.length,
        totalRecords: totalRecords,
        executionPlan: executionPlanInfo
      };

      return {
        success: true,
        message: `DBA diagnostic batch executed successfully. Retrieved ${totalRecords} record(s) across ${recordsetsArray.length} recordset(s). Execution time: ${executionTime}ms`,
        data: recordsetsArray.length === 1 ? recordsetsArray[0] : recordsetsArray,
        diagnostics: diagnosticInfo,
        recordsets: recordsetsArray,
        executionTimeMs: executionTime,
        executionPlan: executionPlanInfo
      };
      
    } catch (error) {
      console.error("Error executing DBA diagnostic batch:", error);
      
      // Provide more detailed error information for DBA troubleshooting
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      
      return {
        success: false,
        message: `Failed to execute DBA diagnostic batch: ${errorMessage}`,
        error: 'DBA_QUERY_EXECUTION_FAILED',
        diagnostics: {
          sqlError: errorMessage,
          errorCode: (error as any)?.number || 'Unknown',
          severity: (error as any)?.severity || 'Unknown',
          state: (error as any)?.state || 'Unknown'
        }
      };
    }
  }
}