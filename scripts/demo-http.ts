import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CustomerStore } from '../src/customer/store.js';
import { GatewayAudit } from '../src/gateway/audit.js';
import { issueDemoToken } from '../src/gateway/auth.js';
import { startCustomerHttp } from '../src/mcp/http.js';
import { startGateway } from '../src/gateway/server.js';

const directory = await mkdtemp(join(tmpdir(), 'bridgelayer-http-demo-'));
const store = new CustomerStore(join(directory, 'customer.sqlite'));
const audit = new GatewayAudit(join(directory, 'audit.sqlite'));
const jwtSecret = randomBytes(32).toString('hex');
const serviceKey = randomBytes(32).toString('hex');
const clients: Client[] = [];
let customer: Awaited<ReturnType<typeof startCustomerHttp>> | undefined;
let gateway: Awaited<ReturnType<typeof startGateway>> | undefined;
try {
  customer = await startCustomerHttp({ store, serviceKey });
  gateway = await startGateway({ downstreamUrl: customer.url, serviceKey, jwtSecret, audit });
  const connect = async (role: 'viewer' | 'admin') => {
    const token = await issueDemoToken(jwtSecret, { role, tenant_id: 'demo-tenant', sub: 'demo-user' });
    const client = new Client({ name: `bridgelayer-${role}-demo`, version: '0.1.0' });
    clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(new URL(gateway!.url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }) as Transport); // Pinned SDK optional-property declaration mismatch.
    return client;
  };
  const viewer = await connect('viewer');
  const admin = await connect('admin');
  const listed = await viewer.listTools();
  assert.ok(listed.tools.some(tool => tool.name === 'admin_health_check'));
  console.log('1. Viewer discovers all tools:', listed.tools.map(tool => tool.name));
  console.log('2. Lookup:', (await viewer.callTool({
    name: 'get_customer_record', arguments: { customer_id: 'CUST-00001' },
  })).structuredContent);
  console.log('3. Simulated refund:', (await viewer.callTool({
    name: 'trigger_refund', arguments: { customer_id: 'CUST-00001', amount: 12.5, reason: 'Duplicate subscription charge' },
  })).structuredContent);
  let rejected = false;
  try { await viewer.callTool({ name: 'admin_health_check', arguments: {} }); }
  catch (error) {
    rejected = error instanceof Error && 'code' in error && error.code === -32001;
    console.log('4. Viewer admin call rejected: -32001 Unauthorized Tool Call');
  }
  assert.ok(rejected);
  console.log('5. Admin call:', (await admin.callTool({ name: 'admin_health_check', arguments: {} })).structuredContent);
  assert.equal((await fetch(gateway.url, { method: 'POST' })).status, 401);
  console.log('6. Missing token rejected: HTTP 401. Denials recorded in temporary SQLite audit.');
} finally {
  await Promise.all(clients.map(client => client.close()));
  await gateway?.close(); await customer?.close(); audit.close(); store.close();
  await rm(directory, { recursive: true, force: true });
}
