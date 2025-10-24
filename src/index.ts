#!/usr/bin/env node

// External imports
import sql from "mssql";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Azure Identity import
import { DefaultAzureCredential, InteractiveBrowserCredential } from "@azure/identity";

// Internal imports - Files need to be in tools directory
import { UpdateDataTool } from "./tools/UpdateDataTool.js";
import { InsertDataTool } from "./tools/InsertDataTool.js";
import { ReadDataTool } from "./tools/ReadDataTool.js";
import { CreateTableTool } from "./tools/CreateTableTool.js";
import { CreateIndexTool } from "./tools/CreateIndexTool.js";
import { ListTableTool } from "./tools/ListTableTool.js";
import { DropTableTool } from "./tools/DropTableTool.js";
import { DescribeTableTool } from "./tools/DescribeTableTool.js";
// Additional Tools
import { DBA_InsertDataTool } from "./tools/DBA_InsertDataTool.js";
import { DBA_ReadDataTool } from "./tools/DBA_ReadDataTool.js";
import { CheckDBTool } from "./tools/CheckDBTool.js";
import { sp_WhoisActiveTool } from "./tools/sp_WhoisactiveTool.js";
import { sp_BlitzTool } from "./tools/sp_BlitzTool.js";
import { sp_PressureDetectorTool } from "./tools/sp_PressureDetectorTool.js";
import { BackupStatusTool } from "./tools/BackupStatusTool.js";
import { CheckConnectivityTool } from "./tools/CheckConnectivityTool.js";
import { DatabaseStatusTool } from "./tools/DatabaseStatusTool.js";
import { IOHotspotsTool } from "./tools/IOHotspotsTool.js";
import { IndexUsageStatsTool } from "./tools/IndexUsageStatsTool.js";
import { QueryPlanTool } from "./tools/QueryPlanTool.js";
import { StatisticsUpdateTool } from "./tools/StatisticsUpdateTool.js";
import { WaitStatsTool } from "./tools/WaitStatsTool.js";
import { GetStoredProcedureTextTool } from "./tools/GetStoredProcedureTextTool.js";

// MSSQL Database connection configuration
const credential = new DefaultAzureCredential();

// Globals for connection and token reuse
let globalSqlPool: sql.ConnectionPool | null = null;
let globalAccessToken: string | null = null;
let globalTokenExpiresOn: Date | null = null;

// Function to create SQL config with support for both authentication methods
export async function createSqlConfig(): Promise<{ config: sql.config, token?: string, expiresOn?: Date }> {
  const trustServerCertificate = process.env.TRUST_SERVER_CERTIFICATE?.toLowerCase() === 'true';
  const connectionTimeout = process.env.CONNECTION_TIMEOUT ? parseInt(process.env.CONNECTION_TIMEOUT, 10) : 30;
  const useAzureAuth = process.env.USE_AZURE_AUTH?.toLowerCase() === 'true';
  let serverInfo = process.env.SERVER_NAME!.split(":");
  let serverName = serverInfo[0];
  let serverPort = 1434;
  if (serverInfo.length > 1)
  {
    try {
     serverPort = Number(serverInfo[1]);
    } catch { }
  }

  if (!serverPort)
    throw new Error(`Incorrect port format: ${serverInfo[1]}. SERVER_NAME: ${serverInfo}`);

  const baseConfig = {
    server: serverName,
    database: process.env.DATABASE_NAME!,
    port: serverPort,
    options: {
      // Enable encryption for data in transit
      encrypt: true,
      // Enable or disable trusting server certificate based on env variable
      trustServerCertificate: trustServerCertificate,
      // Enable arithmetic abort for better compatibility
      enableArithAbort: true,
      // Add additional query options for better performance
      abortTransactionOnError: true
    },
    connectionTimeout: connectionTimeout * 1000, // convert seconds to milliseconds,
    requestTimeout: 3600000,
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
        acquireTimeoutMillis: 60000
    },
  };

  if (useAzureAuth) {
    if (!process.env.SERVER_NAME || !process.env.DATABASE_NAME) {
        throw new Error("Missing required environment variables for Azure Auth: SERVER_NAME, DATABASE_NAME");
    }
    // Use Azure Active Directory authentication
    const credential = new InteractiveBrowserCredential({
      redirectUri: 'http://localhost'
    });
    const accessToken = await credential.getToken('https://database.windows.net/.default');

    return {
      config: {
        ...baseConfig,
        authentication: {
          type: 'azure-active-directory-access-token',
          options: {
            token: accessToken?.token!,
          },
        },
        connectionTimeout: connectionTimeout * 1000, // convert seconds to milliseconds
      },
      token: accessToken?.token!,
      expiresOn: accessToken?.expiresOnTimestamp ? new Date(accessToken.expiresOnTimestamp) : new Date(Date.now() + 30 * 60 * 1000)
    };
  } else {
    if (!process.env.SERVER_NAME || !process.env.DATABASE_NAME || (!process.env.USERNAME && !process.env.SQLUSERNAME) || !process.env.PASSWORD) {
        throw new Error("Missing required environment variables: SERVER_NAME, DATABASE_NAME, USERNAME OR SQLUSERNAME, PASSWORD");
    }
    // Use SQL Server authentication
    return {
      config: {
        ...baseConfig,
        user: process.env.SQLUSERNAME ?? process.env.USERNAME,
        password: process.env.PASSWORD!,
      }
    };
  }
}

// Initialize all tool instances
const updateDataTool = new UpdateDataTool();
const insertDataTool = new InsertDataTool();
const readDataTool = new ReadDataTool();
const createTableTool = new CreateTableTool();
const createIndexTool = new CreateIndexTool();
const listTableTool = new ListTableTool();
const dropTableTool = new DropTableTool();
const describeTableTool = new DescribeTableTool();
const dbaInsertDataTool = new DBA_InsertDataTool();
const dbaReadDataTool = new DBA_ReadDataTool();
const checkDBTool = new CheckDBTool();
const sp_whoisactiveTool = new sp_WhoisActiveTool();
const sp_blitzTool = new sp_BlitzTool();
const sp_pressureDetectorTool = new sp_PressureDetectorTool();
const backupStatusTool = new BackupStatusTool();
const checkConnectivityTool = new CheckConnectivityTool();
const databaseStatusTool = new DatabaseStatusTool();
const ioHotspotsTool = new IOHotspotsTool();
const indexUsageStatsTool = new IndexUsageStatsTool();
const queryPlanTool = new QueryPlanTool();
const statisticsUpdateTool = new StatisticsUpdateTool();
const waitStatsTool = new WaitStatsTool();
const getStoredProcedureTextTool = new GetStoredProcedureTextTool();

const server = new Server(
  {
    name: "mssql-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Read READONLY env variable
const isReadOnly = process.env.READONLY === "true";

// Request handlers

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: isReadOnly
    ? [listTableTool, readDataTool, describeTableTool, dbaReadDataTool, dbaInsertDataTool, sp_whoisactiveTool, sp_blitzTool, sp_pressureDetectorTool, backupStatusTool, checkConnectivityTool, databaseStatusTool, ioHotspotsTool, indexUsageStatsTool, queryPlanTool, waitStatsTool, getStoredProcedureTextTool] // Read-only tools for monitoring and analysis. todo: add searchDataTool to the list of tools available in readonly mode once implemented
    : [insertDataTool, readDataTool, describeTableTool, updateDataTool, createTableTool, createIndexTool, dropTableTool, listTableTool, dbaInsertDataTool, dbaReadDataTool, checkDBTool, sp_whoisactiveTool, sp_blitzTool, sp_pressureDetectorTool, backupStatusTool, checkConnectivityTool, databaseStatusTool, ioHotspotsTool, indexUsageStatsTool, queryPlanTool, statisticsUpdateTool, waitStatsTool, getStoredProcedureTextTool], // add all new tools here including write operations
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let result;
    switch (name) {
      case insertDataTool.name:
        result = await insertDataTool.run(args);
        break;
      case readDataTool.name:
        result = await readDataTool.run(args);
        break;
      case updateDataTool.name:
        result = await updateDataTool.run(args);
        break;
      case createTableTool.name:
        result = await createTableTool.run(args);
        break;
      case createIndexTool.name:
        result = await createIndexTool.run(args);
        break;
      case listTableTool.name:
        result = await listTableTool.run(args);
        break;
      case dropTableTool.name:
        result = await dropTableTool.run(args);
        break;
      case describeTableTool.name:
        if (!args || typeof args.tableName !== "string") {
          return {
            content: [{ type: "text", text: `Missing or invalid 'tableName' argument for describe_table tool.` }],
            isError: true,
          };
        }
        result = await describeTableTool.run(args as { tableName: string });
        break;
      case dbaInsertDataTool.name:
          result = await dbaInsertDataTool.run(args);
          break;
      case dbaReadDataTool.name:
          result = await dbaReadDataTool.run(args);
          break;
      case checkDBTool.name:
          result = await checkDBTool.run(args);
          break;
      case sp_whoisactiveTool.name:
          result = await sp_whoisactiveTool.run(args);
          break;
      case sp_blitzTool.name:
          result = await sp_blitzTool.run(args);
          break;
      case sp_pressureDetectorTool.name:
          result = await sp_pressureDetectorTool.run(args);
          break;
      case backupStatusTool.name:
          result = await backupStatusTool.run(args);
          break;
      case checkConnectivityTool.name:
          result = await checkConnectivityTool.run(args);
          break;
      case databaseStatusTool.name:
          result = await databaseStatusTool.run(args);
          break;
      case ioHotspotsTool.name:
          result = await ioHotspotsTool.run(args);
          break;
      case indexUsageStatsTool.name:
          result = await indexUsageStatsTool.run(args);
          break;
      case queryPlanTool.name:
          result = await queryPlanTool.run(args);
          break;
      case statisticsUpdateTool.name:
          result = await statisticsUpdateTool.run(args);
          break;
      case waitStatsTool.name:
          result = await waitStatsTool.run(args);
          break;
      case describeTableTool.name:
        if (!args || typeof args.tableName !== "string") {
          return {
            content: [{ type: "text", text: `Missing or invalid 'tableName' argument for describe_table tool.` }],
            isError: true,
          };
        }
        result = await describeTableTool.run(args as { tableName: string });
        break;
      case getStoredProcedureTextTool.name:
        if (!args || typeof args.storedProcName !== "string") {
          return {
            content: [{ type: "text", text: `Missing or invalid 'storedProcName' argument for get_stored_procedure_text tool.` }],
            isError: true,
          };
        }
        result = await getStoredProcedureTextTool.run(args as { storedProcName: string });
        break;
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error occurred: ${error}` }],
      isError: true,
    };
  }
});

// Server startup
async function runServer() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    console.error("Fatal error running server:", error);
    process.exit(1);
  }
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});

// Connect to SQL only when handling a request

async function ensureSqlConnection() {
  const useAzureAuth = process.env.USE_AZURE_AUTH?.toLowerCase() === 'true';

  if (useAzureAuth) {
    // For Azure Auth, check token expiration
    // If we have a pool and it's connected, and the token is still valid, reuse it
    if (
      globalSqlPool &&
      globalSqlPool.connected &&
      globalAccessToken &&
      globalTokenExpiresOn &&
      globalTokenExpiresOn > new Date(Date.now() + 2 * 60 * 1000) // 2 min buffer
    ) {
      return;
    }
  } else {
    // For SQL Server Auth, just check if connected
    if (globalSqlPool?.connected) {
      return;
    }
  }

  // Otherwise, get a new token and reconnect
  const { config, token, expiresOn } = await createSqlConfig();

  if (useAzureAuth && token && expiresOn) {
    globalAccessToken = token;
    globalTokenExpiresOn = expiresOn;
  }

  // Close old pool if exists
  if (globalSqlPool && globalSqlPool.connected) {
    await globalSqlPool.close();
  }

  globalSqlPool = await sql.connect(config);
}

// Patch all tool handlers to ensure SQL connection before running
function wrapToolRun(tool: { run: (...args: any[]) => Promise<any> }) {
  const originalRun = tool.run.bind(tool);
  tool.run = async function (...args: any[]) {
    await ensureSqlConnection();
    return originalRun(...args);
  };
}
// Apply connection wrapper to all tools
[insertDataTool, readDataTool, describeTableTool, updateDataTool, createTableTool,
  createIndexTool, dropTableTool, listTableTool, dbaInsertDataTool, dbaReadDataTool,
  checkDBTool, sp_whoisactiveTool, sp_blitzTool, sp_pressureDetectorTool, backupStatusTool,
  checkConnectivityTool, databaseStatusTool, ioHotspotsTool, indexUsageStatsTool, queryPlanTool,
  statisticsUpdateTool, waitStatsTool, getStoredProcedureTextTool].forEach(wrapToolRun);