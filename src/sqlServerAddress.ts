export interface SqlServerAddress {
  server: string;
  port?: number;
  instanceName?: string;
}

/** Parse host, host:port, host,port and named instances in either order. */
export function parseSqlServerAddress(value: string | undefined): SqlServerAddress {
  const input = value?.trim().replace(/^tcp:/i, "");
  if (!input) throw new Error("Missing required environment variable: SERVER_NAME");
  const match = /^(\[[^\]]+\]|[^\\,:/\s]+)(?:[,:](\d+))?(?:\\([^\\,:/\s]+))?(?:[,:](\d+))?$/.exec(input);
  if (!match || (match[2] && match[4])) {
    throw new Error("Invalid SERVER_NAME format. Expected host[,port][\\instance] or host\\instance[,port]");
  }
  const portText = match[2] ?? match[4];
  const port = portText === undefined ? undefined : Number(portText);
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error("SERVER_NAME port must be an integer between 1 and 65535");
  }
  return {
    server: match[1].replace(/^\[|\]$/g, ""),
    ...(port === undefined ? {} : { port }),
    ...(match[3] === undefined ? {} : { instanceName: match[3] }),
  };
}

/** Explicit TCP ports take precedence over SQL Browser instance discovery. */
export function sqlServerConnectionTarget(address: SqlServerAddress) {
  return {
    server: address.server,
    ...(address.port !== undefined ? { port: address.port } :
      address.instanceName ? {} : { port: 1433 }),
    options: address.port === undefined && address.instanceName
      ? { instanceName: address.instanceName } : {},
  };
}
