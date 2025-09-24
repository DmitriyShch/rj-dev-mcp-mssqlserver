import sql from "mssql";

interface Tool {
  [key: string]: any;
  name: string;
  description: string;
  inputSchema: any;
  run(params: any): Promise<any>;
}

// Create Partition Function Tool
export class CreatePartitionFunctionTool implements Tool {
  [key: string]: any;
  name = "create_partition_function";
  description = "Creates a partition function in the MSSQL Database with specified boundaries.";
  
  inputSchema = {
    type: "object",
    properties: {
      functionName: {
        type: "string",
        description: "Name of the partition function to create"
      },
      dataType: {
        type: "string",
        description: "Data type for the partition column (e.g., 'datetime', 'int', 'varchar(50)')",
        default: "datetime"
      },
      rangeType: {
        type: "string",
        enum: ["LEFT", "RIGHT"],
        description: "Range type - LEFT or RIGHT",
        default: "RIGHT"
      },
      boundaryValues: {
        type: "array",
        items: { type: "string" },
        description: "Array of boundary values as strings (e.g., ['2020-01-01', '2021-01-01'] for datetime)"
      }
    },
    required: ["functionName", "boundaryValues"],
  } as any;

  async run(params: { 
    functionName: string; 
    dataType?: string; 
    rangeType?: string; 
    boundaryValues: string[] 
  }) {
    try {
      const { 
        functionName, 
        dataType = "datetime", 
        rangeType = "RIGHT", 
        boundaryValues 
      } = params;

      // Validate inputs
      if (!functionName || functionName.trim().length === 0) {
        return {
          success: false,
          message: "Function name cannot be empty",
          error: "INVALID_INPUT"
        };
      }

      if (!boundaryValues || boundaryValues.length === 0) {
        return {
          success: false,
          message: "At least one boundary value is required",
          error: "INVALID_INPUT"
        };
      }

      // Sanitize function name (basic validation)
      const safeFunctionName = functionName.replace(/[^a-zA-Z0-9_]/g, '');
      if (safeFunctionName !== functionName) {
        return {
          success: false,
          message: "Function name contains invalid characters. Use only letters, numbers, and underscores.",
          error: "INVALID_INPUT"
        };
      }

      // Format boundary values for SQL
      const formattedValues = boundaryValues.map(value => `'${value}'`).join(', ');

      // Build the SQL statement
      const sql_statement = `
        CREATE PARTITION FUNCTION ${safeFunctionName} (${dataType})
        AS RANGE ${rangeType.toUpperCase()} FOR VALUES (${formattedValues})
      `.trim();

      console.log(`Creating partition function: ${safeFunctionName} with ${boundaryValues.length} boundaries`);

      // Execute the SQL
      const request = new sql.Request();
      await request.query(sql_statement);

      return {
        success: true,
        message: `Partition function '${safeFunctionName}' created successfully with ${boundaryValues.length} boundary values.`,
        functionName: safeFunctionName,
        boundaryCount: boundaryValues.length,
        dataType: dataType,
        rangeType: rangeType.toUpperCase()
      };

    } catch (error) {
      console.error("Error creating partition function:", error);
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      
      let safeErrorMessage = 'Failed to create partition function';
      if (errorMessage.includes('already exists')) {
        safeErrorMessage = 'Partition function with this name already exists';
      } else if (errorMessage.includes('Invalid column name')) {
        safeErrorMessage = 'Invalid data type specified';
      } else if (errorMessage.includes('boundary values')) {
        safeErrorMessage = 'Invalid boundary values provided';
      } else if (errorMessage.includes('permission')) {
        safeErrorMessage = 'Insufficient permissions to create partition function';
      }

      return {
        success: false,
        message: safeErrorMessage,
        error: 'PARTITION_FUNCTION_CREATION_FAILED',
        details: errorMessage
      };
    }
  }
}

// Create Partition Scheme Tool
export class CreatePartitionSchemeTool implements Tool {
  [key: string]: any;
  name = "create_partition_scheme";
  description = "Creates a partition scheme in the MSSQL Database that maps a partition function to filegroups.";
  
  inputSchema = {
    type: "object",
    properties: {
      schemeName: {
        type: "string",
        description: "Name of the partition scheme to create"
      },
      functionName: {
        type: "string",
        description: "Name of the existing partition function to use"
      },
      filegroups: {
        type: "array",
        items: { type: "string" },
        description: "Array of filegroup names. Use ['PRIMARY'] for all partitions on primary filegroup, or specify individual filegroups",
        default: ["PRIMARY"]
      },
      allToPrimary: {
        type: "boolean",
        description: "If true, maps all partitions to the PRIMARY filegroup using 'ALL TO ([PRIMARY])' syntax",
        default: true
      }
    },
    required: ["schemeName", "functionName"],
  } as any;

  async run(params: { 
    schemeName: string; 
    functionName: string; 
    filegroups?: string[];
    allToPrimary?: boolean;
  }) {
    try {
      const { 
        schemeName, 
        functionName,
        filegroups = ["PRIMARY"],
        allToPrimary = true
      } = params;

      // Validate inputs
      if (!schemeName || schemeName.trim().length === 0) {
        return {
          success: false,
          message: "Scheme name cannot be empty",
          error: "INVALID_INPUT"
        };
      }

      if (!functionName || functionName.trim().length === 0) {
        return {
          success: false,
          message: "Function name cannot be empty",
          error: "INVALID_INPUT"
        };
      }

      // Sanitize names
      const safeSchemeName = schemeName.replace(/[^a-zA-Z0-9_]/g, '');
      const safeFunctionName = functionName.replace(/[^a-zA-Z0-9_]/g, '');

      if (safeSchemeName !== schemeName || safeFunctionName !== functionName) {
        return {
          success: false,
          message: "Names contain invalid characters. Use only letters, numbers, and underscores.",
          error: "INVALID_INPUT"
        };
      }

      // Build the SQL statement
      let sql_statement: string;
      
      if (allToPrimary) {
        sql_statement = `
          CREATE PARTITION SCHEME ${safeSchemeName}
          AS PARTITION ${safeFunctionName}
          ALL TO ([PRIMARY])
        `.trim();
      } else {
        const formattedFilegroups = filegroups.map(fg => `[${fg}]`).join(', ');
        sql_statement = `
          CREATE PARTITION SCHEME ${safeSchemeName}
          AS PARTITION ${safeFunctionName}
          TO (${formattedFilegroups})
        `.trim();
      }

      console.log(`Creating partition scheme: ${safeSchemeName} for function: ${safeFunctionName}`);

      // Execute the SQL
      const request = new sql.Request();
      await request.query(sql_statement);

      return {
        success: true,
        message: `Partition scheme '${safeSchemeName}' created successfully for function '${safeFunctionName}'.`,
        schemeName: safeSchemeName,
        functionName: safeFunctionName,
        mappingType: allToPrimary ? "ALL TO PRIMARY" : "EXPLICIT FILEGROUPS",
        filegroups: allToPrimary ? ["PRIMARY"] : filegroups
      };

    } catch (error) {
      console.error("Error creating partition scheme:", error);
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      
      let safeErrorMessage = 'Failed to create partition scheme';
      if (errorMessage.includes('already exists')) {
        safeErrorMessage = 'Partition scheme with this name already exists';
      } else if (errorMessage.includes('does not exist')) {
        safeErrorMessage = 'Specified partition function does not exist';
      } else if (errorMessage.includes('filegroup')) {
        safeErrorMessage = 'Invalid filegroup specified';
      } else if (errorMessage.includes('permission')) {
        safeErrorMessage = 'Insufficient permissions to create partition scheme';
      }

      return {
        success: false,
        message: safeErrorMessage,
        error: 'PARTITION_SCHEME_CREATION_FAILED',
        details: errorMessage
      };
    }
  }
}

// Drop Partition Function Tool
export class DropPartitionFunctionTool implements Tool {
  [key: string]: any;
  name = "drop_partition_function";
  description = "Drops a partition function from the MSSQL Database.";
  
  inputSchema = {
    type: "object",
    properties: {
      functionName: {
        type: "string",
        description: "Name of the partition function to drop"
      }
    },
    required: ["functionName"],
  } as any;

  async run(params: { functionName: string }) {
    try {
      const { functionName } = params;

      if (!functionName || functionName.trim().length === 0) {
        return {
          success: false,
          message: "Function name cannot be empty",
          error: "INVALID_INPUT"
        };
      }

      const safeFunctionName = functionName.replace(/[^a-zA-Z0-9_]/g, '');
      if (safeFunctionName !== functionName) {
        return {
          success: false,
          message: "Function name contains invalid characters",
          error: "INVALID_INPUT"
        };
      }

      const sql_statement = `DROP PARTITION FUNCTION ${safeFunctionName}`;

      console.log(`Dropping partition function: ${safeFunctionName}`);

      const request = new sql.Request();
      await request.query(sql_statement);

      return {
        success: true,
        message: `Partition function '${safeFunctionName}' dropped successfully.`,
        functionName: safeFunctionName
      };

    } catch (error) {
      console.error("Error dropping partition function:", error);
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      
      let safeErrorMessage = 'Failed to drop partition function';
      if (errorMessage.includes('does not exist')) {
        safeErrorMessage = 'Partition function does not exist';
      } else if (errorMessage.includes('is currently being used')) {
        safeErrorMessage = 'Partition function is in use by a partition scheme and cannot be dropped';
      }

      return {
        success: false,
        message: safeErrorMessage,
        error: 'PARTITION_FUNCTION_DROP_FAILED',
        details: errorMessage
      };
    }
  }
}

// Drop Partition Scheme Tool
export class DropPartitionSchemeTool implements Tool {
  [key: string]: any;
  name = "drop_partition_scheme";
  description = "Drops a partition scheme from the MSSQL Database.";
  
  inputSchema = {
    type: "object",
    properties: {
      schemeName: {
        type: "string",
        description: "Name of the partition scheme to drop"
      }
    },
    required: ["schemeName"],
  } as any;

  async run(params: { schemeName: string }) {
    try {
      const { schemeName } = params;

      if (!schemeName || schemeName.trim().length === 0) {
        return {
          success: false,
          message: "Scheme name cannot be empty",
          error: "INVALID_INPUT"
        };
      }

      const safeSchemeName = schemeName.replace(/[^a-zA-Z0-9_]/g, '');
      if (safeSchemeName !== schemeName) {
        return {
          success: false,
          message: "Scheme name contains invalid characters",
          error: "INVALID_INPUT"
        };
      }

      const sql_statement = `DROP PARTITION SCHEME ${safeSchemeName}`;

      console.log(`Dropping partition scheme: ${safeSchemeName}`);

      const request = new sql.Request();
      await request.query(sql_statement);

      return {
        success: true,
        message: `Partition scheme '${safeSchemeName}' dropped successfully.`,
        schemeName: safeSchemeName
      };

    } catch (error) {
      console.error("Error dropping partition scheme:", error);
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      
      let safeErrorMessage = 'Failed to drop partition scheme';
      if (errorMessage.includes('does not exist')) {
        safeErrorMessage = 'Partition scheme does not exist';
      } else if (errorMessage.includes('is currently being used')) {
        safeErrorMessage = 'Partition scheme is in use by tables and cannot be dropped';
      }

      return {
        success: false,
        message: safeErrorMessage,
        error: 'PARTITION_SCHEME_DROP_FAILED',
        details: errorMessage
      };
    }
  }
}

// List Partition Functions Tool
export class ListPartitionFunctionsTool implements Tool {
  [key: string]: any;
  name = "list_partition_functions";
  description = "Lists all partition functions in the current database with their details.";
  
  inputSchema = {
    type: "object",
    properties: {},
    required: [],
  } as any;

  async run(params: {}) {
    try {
      const sql_statement = `
        SELECT 
          pf.name AS function_name,
          pf.type_desc AS range_type,
          pf.fanout AS partition_count,
          t.name AS data_type,
          pf.create_date,
          pf.modify_date,
          STRING_AGG(CAST(prv.value AS varchar(50)), ', ') WITHIN GROUP (ORDER BY prv.boundary_id) AS boundary_values
        FROM sys.partition_functions pf
        INNER JOIN sys.types t ON pf.parameter_type_id = t.user_type_id
        LEFT JOIN sys.partition_range_values prv ON pf.function_id = prv.function_id
        GROUP BY pf.name, pf.type_desc, pf.fanout, t.name, pf.create_date, pf.modify_date
        ORDER BY pf.name
      `;

      const request = new sql.Request();
      const result = await request.query(sql_statement);

      return {
        success: true,
        message: `Found ${result.recordset.length} partition function(s).`,
        functions: result.recordset
      };

    } catch (error) {
      console.error("Error listing partition functions:", error);
      
      return {
        success: false,
        message: 'Failed to list partition functions',
        error: 'LIST_PARTITION_FUNCTIONS_FAILED'
      };
    }
  }
}