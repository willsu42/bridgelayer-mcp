import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const directory = await mkdtemp(join(tmpdir(), 'supportbridge-demo-'));
const client = new Client({ name: 'supportbridge-demo', version: '0.1.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../src/mcp/stdio.js', import.meta.url))],
  env: { SUPPORTBRIDGE_DB: join(directory, 'demo.sqlite') },
  stderr: 'pipe',
});
transport.stderr?.on('data', chunk => process.stderr.write(chunk));
try {
  await client.connect(transport);
  console.log('1. Discover tools:', (await client.listTools()).tools.map(tool => tool.name));
  console.log('2. Look up a customer:', await client.callTool({ name: 'get_customer_record', arguments: { customer_id: 'CUST-00001' } }));
  console.log('3. Simulate a refund:', await client.callTool({ name: 'trigger_refund', arguments: { customer_id: 'CUST-00001', amount: 12.5, reason: 'Duplicate subscription charge' } }));
  try {
    await client.callTool({ name: 'trigger_refund', arguments: { customer_id: 'CUST-00001', amount: -1, reason: 'Duplicate subscription charge' } });
  } catch (error) {
    console.log('4. Invalid amount rejected:', error instanceof Error ? error.message : 'Error');
  }
} finally {
  await client.close();
  await rm(directory, { recursive: true, force: true });
}
