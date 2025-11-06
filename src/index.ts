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
import { GetViewTextTool } from "./tools/GetViewTextTool.js";

// MSSQL Database connection configuration
const credential = new DefaultAzureCredential();

const sqlGlobal = sql as unknown as {
  on?: (event: string, listener: (...args: any[]) => void) => void;
  close?: () => Promise<void>;
};

// Globals for connection and token reuse
let globalSqlPool: sql.ConnectionPool | null = null;
let globalAccessToken: string | null = null;
let globalTokenExpiresOn: Date | null = null;
let connectionPromise: Promise<sql.ConnectionPool> | null = null;

type TransportErrorInfo = {
  timestamp: string;
  errorSummary: Record<string, unknown>;
};

type TransportCloseInfo = {
  timestamp: string;
  details: unknown[];
};

let lastTransportErrorInfo: TransportErrorInfo | null = null;
let lastTransportCloseInfo: TransportCloseInfo | null = null;

function safeJsonStringify(value: unknown, space = 2): string | undefined {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      value,
      (key, rawValue) => {
        if (typeof rawValue === "object" && rawValue !== null) {
          if (seen.has(rawValue)) {
            return "[Circular]";
          }
          seen.add(rawValue);
        }
        if (typeof rawValue === "function") {
          return `[Function: ${rawValue.name || "anonymous"}]`;
        }
        return rawValue;
      },
      space,
    );
  } catch {
    return undefined;
  }
}

function createErrorSummary(error: unknown): Record<string, unknown> {
  const summary: Record<string, unknown> = {};

  if (error instanceof Error) {
    summary.name = error.name;
    summary.message = error.message;
    summary.stack = error.stack;
    if ("code" in error && typeof (error as { code?: unknown }).code !== "undefined") {
      summary.code = (error as { code?: unknown }).code;
    }
  } else if (typeof error === "string") {
    summary.message = error;
  } else if (error && typeof error === "object") {
    summary.type = error.constructor?.name ?? "Object";
  }

  if (error && typeof error === "object") {
    const source = error as Record<string, unknown>;
    const extraKeys = Object.keys(source).filter(
      (key) => !["name", "message", "stack", "code"].includes(key),
    );

    if (extraKeys.length > 0) {
      const extra: Record<string, unknown> = {};
      for (const key of extraKeys.slice(0, 10)) {
        const value = source[key];
        extra[key] = typeof value === "object" ? safeJsonStringify(value) ?? String(value) : value;
      }
      if (extraKeys.length > 10) {
        extra.__truncated__ = `+${extraKeys.length - 10} keys`;
      }
      summary.extra = extra;
    }
  }

  if (!("raw" in summary)) {
    const serialized = safeJsonStringify(error);
    if (serialized) {
      summary.raw = serialized;
    }
  }

  return summary;
}

function summarizeArgument(value: unknown, depth = 0): unknown {
  if (depth > 2) {
    return "[Truncated]";
  }

  if (Array.isArray(value)) {
    const result = value.slice(0, 5).map((item) => summarizeArgument(item, depth + 1));
    if (value.length > 5) {
      result.push(`+${value.length - 5} items`);
    }
    return result;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const limitedEntries = entries.slice(0, 10).map(([key, val]) => [key, summarizeArgument(val, depth + 1)]);
    const result: Record<string, unknown> = Object.fromEntries(limitedEntries);
    if (entries.length > 10) {
      result.__truncated__ = `+${entries.length - 10} keys`;
    }
    return result;
  }

  if (typeof value === "function") {
    return `[Function: ${(value as { name?: string }).name || "anonymous"}]`;
  }

  return value;
}

function buildDetailedErrorReport(error: unknown, context: { toolName: string; args: unknown }): string {
  const report: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    toolName: context.toolName,
    isConnectionError: isConnectionError(error),
    sqlPool: {
      hasPool: Boolean(globalSqlPool),
      isConnected: Boolean(globalSqlPool?.connected),
      hasPendingConnection: Boolean(connectionPromise),
    },
    transport: {
      lastError: lastTransportErrorInfo,
      lastClose: lastTransportCloseInfo,
    },
    process: {
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      memoryUsage: process.memoryUsage(),
    },
    error: createErrorSummary(error),
  };

  if (typeof context.args !== "undefined") {
    report.toolArguments = summarizeArgument(context.args);
  }

  const serializedReport = safeJsonStringify(report);
  return serializedReport ?? String(report);
}

const CONNECTION_ERROR_CODES = new Set([
  "ESOCKET",
  "ECONNRESET",
  "ETIMEOUT",
  "ETIMEDOUT",
  "ELOGIN",
  "ENOTFOUND",
  "ECONNREFUSED",
  "EPIPE",
]);

const CONNECTION_ERROR_MESSAGE_SNIPPETS = [
  "connectionerror",
  "connection is closed",
  "failed to connect",
  "socket hang up",
  "socket closed",
  "socket has been ended",
  "econnreset",
  "econnrefused",
  "semaphore timeout period has expired",
  "timed out waiting for connection",
  "transport input closed",
  "login failed for user",
  "token expired",
];

sqlGlobal.on?.("error", (error: unknown) => {
  console.error("Global MSSQL connection error detected:", error);
  void resetSqlConnection();
});

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

function normalizeErrorMessage(error: unknown): string {
  if (!error) {
    return "";
  }

  if (typeof error === "string") {
    return error.toLowerCase();
  }

  if (error instanceof Error && typeof error.message === "string") {
    return error.message.toLowerCase();
  }

  const message = (error as { message?: unknown })?.message;
  if (typeof message === "string") {
    return message.toLowerCase();
  }

  try {
    return JSON.stringify(error).toLowerCase();
  } catch {
    return String(error).toLowerCase();
  }
}

function isConnectionError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const candidate = error as { code?: unknown; name?: unknown };

  if (typeof candidate.code === "string" && CONNECTION_ERROR_CODES.has(candidate.code)) {
    return true;
  }

  if (typeof candidate.name === "string" && candidate.name.toLowerCase().includes("connectionerror")) {
    return true;
  }

  const normalizedMessage = normalizeErrorMessage(error);
  return CONNECTION_ERROR_MESSAGE_SNIPPETS.some((snippet) => normalizedMessage.includes(snippet));
}

function shouldRetryResult(result: unknown): boolean {
  if (!result) {
    return false;
  }

  const messages: string[] = [];

  if (typeof result === "string") {
    messages.push(result.toLowerCase());
  } else if (typeof result === "object") {
    const maybeMessage = (result as { message?: unknown }).message;
    const maybeError = (result as { error?: unknown }).error;

    if (typeof maybeMessage === "string") {
      messages.push(maybeMessage.toLowerCase());
    }

    if (typeof maybeError === "string") {
      messages.push(maybeError.toLowerCase());
    }
  }

  return messages.some((message) =>
    CONNECTION_ERROR_MESSAGE_SNIPPETS.some((snippet) => message.includes(snippet)),
  );
}

async function resetSqlConnection(): Promise<void> {
  if (connectionPromise) {
    try {
      await connectionPromise;
    } catch (error) {
      console.warn("Pending connection attempt failed during reset:", error);
    } finally {
      connectionPromise = null;
    }
  }

  if (globalSqlPool) {
    try {
      await globalSqlPool.close();
    } catch (error) {
      console.warn("Error closing existing SQL pool:", error);
    }
  }

    if (sqlGlobal.close) {
      try {
        await sqlGlobal.close();
      } catch (error) {
        console.warn("Error closing global SQL connections:", error);
      }
    }

  globalSqlPool = null;
  globalAccessToken = null;
  globalTokenExpiresOn = null;
}

function attachPoolErrorHandlers(pool: sql.ConnectionPool) {
  pool.on("error", (error) => {
    console.error("SQL pool error detected:", error);
    void resetSqlConnection();
  });
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
const getViewTextTool = new GetViewTextTool();

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
    ? [listTableTool, readDataTool, describeTableTool, dbaReadDataTool, dbaInsertDataTool,
      sp_whoisactiveTool, sp_blitzTool, sp_pressureDetectorTool, backupStatusTool,
      checkConnectivityTool, databaseStatusTool, ioHotspotsTool, indexUsageStatsTool,
      queryPlanTool, waitStatsTool, getStoredProcedureTextTool, getViewTextTool]
      // Read-only tools for monitoring and analysis. todo: add searchDataTool to the list 
      // of tools available in readonly mode once implemented
    : [insertDataTool, readDataTool, describeTableTool, updateDataTool, createTableTool,
      createIndexTool, dropTableTool, listTableTool, dbaInsertDataTool, dbaReadDataTool,
      checkDBTool, sp_whoisactiveTool, sp_blitzTool, sp_pressureDetectorTool, backupStatusTool,
      checkConnectivityTool, databaseStatusTool, ioHotspotsTool, indexUsageStatsTool,
      queryPlanTool, statisticsUpdateTool, waitStatsTool, getStoredProcedureTextTool,
      getViewTextTool], // add all new tools here including write operations
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
            content: [{ type: "text",
              text: `Missing or invalid 'storedProcName' argument for get_stored_procedure_text tool.` }],
            isError: true,
          };
        }
        result = await getStoredProcedureTextTool.run(args as { storedProcName: string });
        break;
      case getViewTextTool.name:
        if (!args || typeof args.viewName !== "string") {
          return {
            content: [{ type: "text",
              text: `Missing or invalid 'viewName' argument for get_view_text tool.` }],
            isError: true,
          };
        }
        result = await getViewTextTool.run(args as { viewName: string });
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
    if (isConnectionError(error)) {
      await resetSqlConnection();
    }
    const detailedReport = buildDetailedErrorReport(error, { toolName: name, args });
    console.error(`Error running tool ${name}:`, detailedReport);
    return {
      content: [{
        type: "text",
        text: `Error occurred while executing tool "${name}". Detailed diagnostics:\n${detailedReport}`,
      }],
      isError: true,
    };
  }
});

// Server startup
async function runServer() {
  try {
    const transport = new StdioServerTransport();

    const transportWithEvents = transport as unknown as {
      on?: (event: string, listener: (...args: any[]) => void) => void;
    };

    if (typeof transportWithEvents.on === "function") {
      transportWithEvents.on("error", (error: unknown) => {
        lastTransportErrorInfo = {
          timestamp: new Date().toISOString(),
          errorSummary: createErrorSummary(error),
        };
        console.error("Transport error detected:", error);
      });
      transportWithEvents.on("close", (...details: unknown[]) => {
        lastTransportCloseInfo = {
          timestamp: new Date().toISOString(),
          details,
        };
        console.error("Transport closed unexpectedly. Cleaning up connections.");
        void resetSqlConnection().finally(() => process.exit(1));
      });
    }

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

async function ensureSqlConnection(): Promise<void> {
  const useAzureAuth = process.env.USE_AZURE_AUTH?.toLowerCase() === "true";

  const hasValidAzureToken = () =>
    Boolean(
      globalAccessToken &&
        globalTokenExpiresOn &&
        globalTokenExpiresOn > new Date(Date.now() + 2 * 60 * 1000),
    );

  if (globalSqlPool?.connected && (!useAzureAuth || hasValidAzureToken())) {
    return;
  }

  if (connectionPromise) {
    await connectionPromise;
    if (globalSqlPool?.connected && (!useAzureAuth || hasValidAzureToken())) {
      return;
    }
  }

  connectionPromise = (async () => {
    if (globalSqlPool) {
      try {
        await globalSqlPool.close();
      } catch (error) {
        console.warn("Error closing existing SQL pool before reconnect:", error);
      } finally {
        globalSqlPool = null;
      }
    }

    if (sqlGlobal.close) {
      try {
        await sqlGlobal.close();
      } catch (error) {
        console.warn("Error closing global SQL connections before reconnect:", error);
      }
    }

    const { config, token, expiresOn } = await createSqlConfig();

    if (useAzureAuth && token && expiresOn) {
      globalAccessToken = token;
      globalTokenExpiresOn = expiresOn;
    } else if (!useAzureAuth) {
      globalAccessToken = null;
      globalTokenExpiresOn = null;
    }

    const pool = await sql.connect(config);
    attachPoolErrorHandlers(pool);
    globalSqlPool = pool;
    return pool;
  })();

  try {
    await connectionPromise;
  } finally {
    connectionPromise = null;
  }
}

// Patch all tool handlers to ensure SQL connection before running
function wrapToolRun(tool: { run: (...args: any[]) => Promise<any> }) {
  const originalRun = tool.run.bind(tool);
  tool.run = async function (...args: any[]) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) {
        await resetSqlConnection();
      }

      await ensureSqlConnection();

      try {
        const result = await originalRun(...args);
        if (attempt === 0 && shouldRetryResult(result)) {
          continue;
        }
        return result;
      } catch (error) {
        if (attempt === 0 && isConnectionError(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new Error("Failed to execute tool after reconnection attempts");
  };
}
// Apply connection wrapper to all tools
[insertDataTool, readDataTool, describeTableTool, updateDataTool, createTableTool, createIndexTool,
  dropTableTool, listTableTool, dbaInsertDataTool, dbaReadDataTool, checkDBTool, sp_whoisactiveTool,
  sp_blitzTool, sp_pressureDetectorTool, backupStatusTool, checkConnectivityTool, databaseStatusTool,
  ioHotspotsTool, indexUsageStatsTool, queryPlanTool, statisticsUpdateTool, waitStatsTool,
  getStoredProcedureTextTool, getViewTextTool].forEach(wrapToolRun);
