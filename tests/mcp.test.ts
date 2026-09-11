import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import { refundInput } from '../src/customer/schemas.js';

type WireResponse = {
  jsonrpc: '2.0'; id?: number | string;
  result?: { tools?: Array<{ name: string; inputSchema: { additionalProperties?: boolean } }>; isError?: boolean; structuredContent?: Record<string, unknown> };
  error?: { code: number; message: string };
};

async function openHarness(t: TestContext, database?: string) {
  const directory = await mkdtemp(join(tmpdir(), 'supportbridge-test-'));
  const dbPath = database ?? join(directory, 'test.sqlite');
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/mcp/stdio.js', import.meta.url))], {
    env: { ...process.env, SUPPORTBRIDGE_DB: dbPath }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  let nextId = 0;
  const lines: string[] = [];
  const pending = new Map<string | number | undefined, { resolve: (value: WireResponse) => void; reject: (reason: Error) => void }>();
  let wireError: Error | undefined;
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const reader = createInterface({ input: child.stdout });
  reader.on('line', line => {
    lines.push(line);
    try {
      const message = JSON.parse(line) as WireResponse;
      JSONRPCMessageSchema.parse(message);
      const waiter = pending.get(message.id);
      if (!waiter) throw new Error(`Unexpected stdout message: ${line}`);
      pending.delete(message.id);
      waiter.resolve(message);
    } catch (error) {
      wireError = error instanceof Error ? error : new Error('Invalid stdout');
      for (const waiter of pending.values()) waiter.reject(wireError);
    }
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => {
      for (const waiter of pending.values()) waiter.reject(new Error(`Server exited: ${code}; ${stderr}`));
      resolve(code);
    });
  });
  t.after(async () => {
    child.stdin.end();
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
    const code = await exited;
    clearTimeout(killTimer);
    reader.close();
    await rm(directory, { recursive: true, force: true });
    assert.equal(code, 0, stderr);
    assert.equal(wireError, undefined);
    assert.ok(lines.length > 0);
    assert.match(stderr, /server.ready/);
    assert.doesNotMatch(stderr, /alex@example.com|Private refund reason/);
  });
  function raw(line: string, id?: string | number): Promise<WireResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`No response: ${line}; ${stderr}`)); }, 3000);
      pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      child.stdin.write(`${line}\n`);
    });
  }
  function request(method: string, params: unknown = {}, id: string | number = ++nextId) {
    return raw(JSON.stringify({ jsonrpc: '2.0', id, method, params }), id);
  }
  const initialized = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'wire-test', version: '1.0.0' } });
  assert.ok(initialized.result);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  return { dbPath, raw, request, notify: (method: string, params: unknown) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`) };
}

const validRefund = { customer_id: 'CUST-00001', amount: 12.5, reason: 'Private refund reason for duplicate charge' };

test('real stdio discovery, lookup, refund, and durable atomic audit', async t => {
  const client = await openHarness(t);
  const listed = await client.request('tools/list');
  assert.deepEqual(listed.result?.tools?.map(tool => tool.name), ['get_customer_record', 'trigger_refund']);
  assert.ok(listed.result?.tools?.every(tool => tool.inputSchema.additionalProperties === false));
  const customer = await client.request('tools/call', { name: 'get_customer_record', arguments: { customer_id: 'CUST-00001' } }, 'customer-request');
  assert.equal(customer.id, 'customer-request');
  assert.equal(customer.result?.structuredContent?.name, 'Alex Rivera');
  const refund = await client.request('tools/call', { name: 'trigger_refund', arguments: validRefund });
  assert.equal(refund.result?.structuredContent?.amount_cents, 1250);
  assert.equal(refund.result?.structuredContent?.status, 'simulated');
  const db = new DatabaseSync(client.dbPath);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM refunds').get()?.count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM audit_events').get()?.count, 1);
  db.close();
  const secondClient = await openHarness(t, client.dbPath);
  const reread = await secondClient.request('tools/call', { name: 'get_customer_record', arguments: { customer_id: 'CUST-00001' } });
  assert.ok(reread.result);
});

test('invalid wire arguments return -32602 and never write refunds', async t => {
  const client = await openHarness(t);
  const invalid = [
    {}, null, [], { ...validRefund, extra: true },
    { ...validRefund, customer_id: 'CUST-ABCDE' }, { ...validRefund, customer_id: 'CUST-00001\n' },
    { ...validRefund, customer_id: ' CUST-00001' }, { ...validRefund, customer_id: 12345 },
    { ...validRefund, amount: 0 }, { ...validRefund, amount: -1 },
    { ...validRefund, amount: '12.5' }, { ...validRefund, amount: true },
    { ...validRefund, amount: null }, { ...validRefund, reason: '123456789' },
    { ...validRefund, reason: '               ' }, { ...validRefund, reason: 1234567890 },
  ];
  for (const args of invalid) {
    const response = await client.request('tools/call', { name: 'trigger_refund', arguments: args });
    assert.equal(response.error?.code, -32602, JSON.stringify(args));
  }
  for (const params of [{}, { name: 12 }, { name: 'missing_tool' }]) {
    assert.equal((await client.request('tools/call', params)).error?.code, -32602);
  }
  // JSON cannot encode NaN or Infinity; exponent overflow still reaches the validator.
  assert.equal((await client.raw('{"jsonrpc":"2.0","id":"overflow","method":"tools/call","params":{"name":"trigger_refund","arguments":{"customer_id":"CUST-00001","amount":1e400,"reason":"Long enough reason"}}}', 'overflow')).error?.code, -32602);
  const db = new DatabaseSync(client.dbPath);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM refunds').get()?.count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM audit_events').get()?.count, 0);
  db.close();
});

test('business failures are tool results; whole cents are preserved', async t => {
  const client = await openHarness(t);
  const missing = await client.request('tools/call', { name: 'get_customer_record', arguments: { customer_id: 'CUST-99999' } });
  assert.equal(missing.error, undefined);
  assert.equal(missing.result?.isError, true);
  for (const amount of [0.001, 1e20]) {
    const response = await client.request('tools/call', { name: 'trigger_refund', arguments: { ...validRefund, amount } });
    assert.equal(response.result?.isError, true);
  }
  for (const [amount, cents] of [[0.29, 29], [1, 100], [0.01, 1]] as const) {
    const response = await client.request('tools/call', { name: 'trigger_refund', arguments: { ...validRefund, amount, reason: '  1234567890  ' } });
    assert.equal(response.result?.structuredContent?.amount_cents, cents);
  }
});

test('audit write failure rolls back the refund and sanitizes the error', async t => {
  const client = await openHarness(t);
  const db = new DatabaseSync(client.dbPath);
  db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'secret_internal_database_detail'); END;");
  const response = await client.request('tools/call', { name: 'trigger_refund', arguments: validRefund });
  assert.equal(response.error?.code, -32603);
  assert.doesNotMatch(JSON.stringify(response), /secret_internal_database_detail|store\.ts|INSERT/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM refunds').get()?.count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM audit_events').get()?.count, 0);
  db.close();
});

test('malformed frames recover, unknown methods fail, and notifications cannot refund', async t => {
  const client = await openHarness(t);
  assert.equal((await client.raw('{broken json')).error?.code, -32700);
  assert.equal((await client.raw('{"jsonrpc":"1.0","id":45,"method":"tools/list"}')).error?.code, -32600);
  assert.equal((await client.request('unknown/method')).error?.code, -32601);
  client.notify('tools/call', { name: 'trigger_refund', arguments: validRefund });
  assert.ok((await client.request('tools/list')).result);
  const db = new DatabaseSync(client.dbPath);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM refunds').get()?.count, 0);
  db.close();
});

test('non-JSON JavaScript numbers are rejected before business logic', () => {
  for (const amount of [NaN, Infinity, -Infinity]) {
    assert.equal(refundInput.safeParse({ ...validRefund, amount }).success, false);
  }
});
