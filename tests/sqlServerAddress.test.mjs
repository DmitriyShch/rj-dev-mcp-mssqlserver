import assert from 'node:assert/strict';
import { parseSqlServerAddress as parse, sqlServerConnectionTarget as target } from '../dist/sqlServerAddress.js';
const cases = [
  ['host', { server: 'host' }],
  ['host:10440', { server: 'host', port: 10440 }],
  ['host,10440', { server: 'host', port: 10440 }],
  ['host\\SQLEXPRESS2025', { server: 'host', instanceName: 'SQLEXPRESS2025' }],
  ['host1,10440\\SQLEXPRESS2025', { server: 'host1', port: 10440, instanceName: 'SQLEXPRESS2025' }],
  ['host:10440\\INSTANCE', { server: 'host', port: 10440, instanceName: 'INSTANCE' }],
  ['host\\INSTANCE,10440', { server: 'host', port: 10440, instanceName: 'INSTANCE' }],
  [' tcp:host,10440 ', { server: 'host', port: 10440 }],
  ['[::1],10440', { server: '::1', port: 10440 }],
];
for (const [input, expected] of cases) assert.deepEqual(parse(input), expected);
for (const input of [undefined, '', 'host,0', 'host,65536', 'host,-1', 'host,1.5', 'host,abc', 'host\\', 'host,1433\\INSTANCE,1444', 'host/INSTANCE']) assert.throws(() => parse(input));
assert.deepEqual(target(parse('host')), { server: 'host', port: 1433, options: {} });
assert.deepEqual(target(parse('host\\INSTANCE')), { server: 'host', options: { instanceName: 'INSTANCE' } });
assert.deepEqual(target(parse('host1,10440\\SQLEXPRESS2025')), { server: 'host1', port: 10440, options: {} });
console.log('SQL Server address parsing and connection target checks passed');
