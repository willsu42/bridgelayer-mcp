import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { once } from 'node:events';
import { SignJWT } from 'jose';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { CustomerStore } from '../src/customer/store.js';
import { GatewayAudit } from '../src/gateway/audit.js';
import { DEMO_AUDIENCE, DEMO_ISSUER, issueDemoToken } from '../src/gateway/auth.js';
import { startGateway } from '../src/gateway/server.js';
import { startCustomerHttp } from '../src/mcp/http.js';
import { json, listenLoopback } from '../src/http/common.js';
import type { LogEvent } from '../src/logger.js';

const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' };
const call = (name: string, args: unknown = {}, id: string | number = 'same-id') =>
  ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const refund = { customer_id: 'CUST-00001', amount: 12.5, reason: 'Private refund reason for duplicate charge' };

async function stack(t: TestContext, fake?: Parameters<typeof listenLoopback>[0], timeoutMs = 3000) {
  const dir = await mkdtemp(join(tmpdir(), 'bridgelayer-http-test-'));
  const store = new CustomerStore(join(dir, 'customer.sqlite'));
  const auditPath = join(dir, 'audit.sqlite');
  const audit = new GatewayAudit(auditPath);
  const serviceKey = randomBytes(32).toString('hex');
  const jwtSecret = randomBytes(32).toString('hex');
  const events: LogEvent[] = [];
  const customer = fake ? await listenLoopback(fake) : await startCustomerHttp({ store, serviceKey });
  let forwarded = 0;
  let inboundAuthorization = false;
  let correctServiceKey = true;
  customer.server.on('request', req => {
    forwarded++;
    inboundAuthorization ||= req.headers.authorization !== undefined || req.headers.cookie !== undefined;
    correctServiceKey &&= req.headers['x-bridgelayer-service-key'] === serviceKey;
  });
  const gateway = await startGateway({
    downstreamUrl: customer.url, serviceKey, jwtSecret, audit, timeoutMs, logger: event => events.push(event),
  });
  t.after(async () => {
    await gateway.close(); await customer.close(); audit.close(); store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const viewer = await issueDemoToken(jwtSecret, { sub: 'viewer', role: 'viewer', tenant_id: 'demo-tenant' });
  const admin = await issueDemoToken(jwtSecret, { sub: 'admin', role: 'admin', tenant_id: 'demo-tenant' });
  const post = (body: unknown, token: string = viewer, extra: Record<string, string> = {}) => fetch(gateway.url, {
    method: 'POST', headers: { ...headers, authorization: `Bearer ${token}`, ...extra }, body: JSON.stringify(body),
  });
  return {
    dir, store, auditPath, audit, jwtSecret, serviceKey, events, gateway, customer, viewer, admin, post,
    forwarded: () => forwarded, leaked: () => inboundAuthorization, serviceKeyOk: () => correctServiceKey,
  };
}

test('official HTTP SDK clients initialize, discover unfiltered tools, call tools, and preserve stdio domain semantics', { timeout: 10_000 }, async t => {
  const s = await stack(t);
  const clients: Client[] = [];
  t.after(async () => { await Promise.all(clients.map(client => client.close())); });
  const connect = async (token: string) => {
    const client = new Client({ name: 'http-test', version: '1.0' });
    clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(new URL(s.gateway.url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }) as Transport);
    return client;
  };
  const viewer = await connect(s.viewer);
  const admin = await connect(s.admin);
  const [viewerTools, adminTools] = await Promise.all([viewer.listTools(), admin.listTools()]);
  assert.deepEqual(viewerTools, adminTools);
  assert.deepEqual(viewerTools.tools.map(tool => tool.name), ['get_customer_record', 'trigger_refund', 'admin_health_check']);
  assert.equal(CallToolResultSchema.parse(await viewer.callTool({ name: 'get_customer_record', arguments: { customer_id: 'CUST-00001' } })).structuredContent?.name, 'Alex Rivera');
  assert.equal(CallToolResultSchema.parse(await viewer.callTool({ name: 'trigger_refund', arguments: refund })).structuredContent?.amount_cents, 1250);
  assert.equal(CallToolResultSchema.parse(await admin.callTool({ name: 'admin_health_check', arguments: {} })).structuredContent?.status, 'ok');
  await assert.rejects(viewer.callTool({ name: 'trigger_refund', arguments: { ...refund, amount: '12.50' } }), { code: -32602 });
  assert.equal((await viewer.callTool({ name: 'get_customer_record', arguments: { customer_id: 'CUST-99999' } })).isError, true);
  assert.equal(s.leaked(), false);
  assert.equal(s.serviceKeyOk(), true);
});

test('non-admin denials preserve IDs, cannot reach downstream, and persist without refund writes', { timeout: 10_000 }, async t => {
  const s = await stack(t);
  for (const id of [0, 'deny-me']) {
    const before = s.forwarded();
    const res = await s.post(call('admin_health_check', {}, id));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { jsonrpc: '2.0', id, error: { code: -32001, message: 'Unauthorized Tool Call' } });
    assert.equal(s.forwarded(), before);
  }
  const deniedNotification = await s.post({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'admin_health_check', arguments: {} } });
  assert.equal(deniedNotification.status, 202);
  assert.equal(await deniedNotification.text(), '');
  assert.equal(s.forwarded(), 0);
  const db = new DatabaseSync(s.auditPath);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM gateway_denials').get()?.count, 3);
  db.close();
  assert.equal(s.store.db.prepare('SELECT COUNT(*) AS count FROM refunds').get()?.count, 0);
  assert.equal(s.store.db.prepare('SELECT COUNT(*) AS count FROM audit_events').get()?.count, 0);
  // A separate connection sees committed denials, with a stable code and typed request-ID JSON.
  const reopened = new DatabaseSync(s.auditPath);
  assert.equal(reopened.prepare("SELECT request_id FROM gateway_denials WHERE request_id = '0'").get()?.request_id, '0');
  reopened.close();
});

test('JWT signature, algorithm, issuer, audience, lifetime, role, and tenant validation deny before forwarding', { timeout: 10_000 }, async t => {
  const s = await stack(t);
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: 'tester', role: 'viewer', tenant_id: 'demo-tenant', iss: DEMO_ISSUER, aud: DEMO_AUDIENCE, iat: now, exp: now + 300 };
  const sign = (payload: Record<string, unknown>, key = s.jwtSecret, alg = 'HS256') =>
    new SignJWT(payload).setProtectedHeader({ alg, typ: 'JWT' }).sign(new TextEncoder().encode(key));
  const omit = (field: string) => Object.fromEntries(Object.entries(claims).filter(([key]) => key !== field));
  const invalid = [
    '', 'not-a-jwt', await sign(claims, randomBytes(32).toString('hex')),
    await sign(claims, s.jwtSecret, 'HS384'), await sign({ ...claims, iss: 'other' }),
    await sign({ ...claims, aud: 'other' }), await sign({ ...claims, exp: now - 1 }),
    await sign({ ...claims, role: 'owner' }), await sign({ ...claims, tenant_id: '' }),
    await sign(omit('tenant_id')), await sign(omit('exp')), await sign(omit('iat')),
    await sign({ ...claims, exp: now + 3600 }), await sign({ ...claims, nbf: now + 300 }),
    await sign({ ...claims, iat: now + 300, exp: now + 600 }),
  ];
  for (const token of invalid) {
    const res = await s.post(call('admin_health_check'), token);
    assert.equal(res.status, 401);
    assert.match(res.headers.get('www-authenticate') ?? '', /Bearer/);
    assert.doesNotMatch(await res.text(), /jwt|signature|secret|stack/i);
  }
  assert.equal(s.forwarded(), 0);
  assert.equal((await fetch(s.gateway.url, { method: 'POST' })).status, 401);
});

test('service bypass, Host/Origin, methods, oversized bodies, malformed frames, batches, and fake sessions are rejected', { timeout: 10_000 }, async t => {
  const s = await stack(t);
  assert.equal((await fetch(s.customer.url, { method: 'POST', headers, body: JSON.stringify(call('admin_health_check')) })).status, 401);
  assert.equal((await fetch(s.customer.url, { method: 'POST', headers: { ...headers, authorization: `Bearer ${s.admin}` }, body: JSON.stringify(call('admin_health_check')) })).status, 401);
  const before = s.forwarded();
  for (const [extra, status] of [
    [{ origin: 'https://evil.example' }, 403], [{ host: 'evil.example' }, 403],
    [{ 'mcp-session-id': 'forged' }, 400], [{ 'content-type': 'text/plain' }, 415],
    [{ accept: 'text/html' }, 406], [{ 'mcp-protocol-version': 'unsupported' }, 400],
  ] as const) assert.equal((await s.post(call('admin_health_check'), s.admin, extra)).status, status);
  assert.equal((await s.post([call('trigger_refund', refund), call('admin_health_check')], s.admin)).status, 400);
  assert.equal((await s.post({ invalid: 'envelope' })).status, 400);
  assert.equal((await s.post(call('trigger_refund', { ...refund, reason: 'x'.repeat(70_000) }))).status, 413);
  assert.equal((await fetch(s.gateway.url, { method: 'POST', headers: { ...headers, authorization: `Bearer ${s.viewer}` }, body: '{broken' })).status, 400);
  for (const method of ['GET', 'DELETE']) {
    const res = await fetch(s.gateway.url, { method, headers: { authorization: `Bearer ${s.viewer}` } });
    assert.equal(res.status, 405);
  }
  assert.equal(s.forwarded(), before);
});

test('concurrent callers can reuse request IDs; caller-supplied credentials never override downstream credentials', { timeout: 10_000 }, async t => {
  const s = await stack(t);
  const responses = await Promise.all(Array.from({ length: 8 }, (_, index) =>
    s.post(call('get_customer_record', { customer_id: index % 2 ? 'CUST-00001' : 'CUST-00002' }, 7), s.viewer, {
      cookie: 'private-cookie', 'x-bridgelayer-service-key': 'attacker-chosen',
    })));
  for (let index = 0; index < responses.length; index++) {
    const result = await responses[index]!.json();
    assert.equal(result.id, 7);
    assert.equal(result.result.structuredContent.customer_id, index % 2 ? 'CUST-00001' : 'CUST-00002');
  }
  assert.equal(s.leaked(), false);
  assert.equal(s.serviceKeyOk(), true);
});

test('malformed tool calls remain correlated and logs omit credentials, records, and arguments', { timeout: 10_000 }, async t => {
  const s = await stack(t);
  const res = await s.post({ jsonrpc: '2.0', id: 'malformed', method: 'tools/call', params: {} });
  const value = await res.json();
  assert.equal(value.id, 'malformed');
  assert.equal(value.error.code, -32602);
  await s.post(call('trigger_refund', refund));
  await s.post(call('admin_health_check'));
  assert.ok(s.events.some(event => event.request_id === 'malformed' && event.outcome === 'rejected'));
  assert.ok(s.events.every(event => typeof event.duration_ms === 'number'));
  const logs = JSON.stringify(s.events);
  for (const secret of [s.jwtSecret, s.serviceKey, s.viewer, 'alex@example.com', refund.reason]) {
    assert.equal(logs.includes(secret), false);
  }
});

test('downstream invalid response, wrong ID, redirects, and errors are sanitized without retries', { timeout: 10_000 }, async t => {
  for (const mode of ['malformed', 'wrong-id', 'redirect', 'failure', 'oversize']) {
    await t.test(mode, { timeout: 10_000 }, async t => {
      const s = await stack(t, async (req, res) => {
        req.resume();
        if (mode === 'redirect') { res.writeHead(302, { location: 'http://127.0.0.1:1/private' }); res.end(); }
        else if (mode === 'failure') json(res, 500, { secret: 'secret_internal_database_detail' });
        else if (mode === 'wrong-id') json(res, 200, { jsonrpc: '2.0', id: 'other', result: {} });
        else if (mode === 'oversize') json(res, 200, { jsonrpc: '2.0', id: 'same-id', result: { text: 'x'.repeat(1_100_000) } });
        else { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{private-invalid'); }
      });
      const response = await s.post(call('trigger_refund', refund));
      assert.equal(response.status, 502);
      const body = await response.json();
      assert.equal(body.id, 'same-id');
      assert.equal(body.error.code, -32002);
      assert.doesNotMatch(JSON.stringify(body), /private|secret_internal|INSERT|stack/);
      assert.equal(s.forwarded(), 1);
    });
  }
});

test('downstream timeout cancels a stalled body and does not replay a write', { timeout: 10_000 }, async t => {
  let closed: Promise<unknown> | undefined;
  const s = await stack(t, async (req, res) => {
    req.resume();
    closed = once(res, 'close');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"jsonrpc":"2.0",');
  }, 75);
  const response = await s.post(call('trigger_refund', refund));
  assert.equal(response.status, 504);
  const body = await response.json();
  assert.equal(body.id, 'same-id');
  assert.equal(body.error.code, -32003);
  assert.match(body.error.message, /outcome may be unknown/);
  await closed;
  assert.equal(s.forwarded(), 1);
  assert.ok(s.events.some(event => event.outcome === 'timeout'));
});

test('caller disconnect and gateway shutdown cancel outstanding downstream requests', { timeout: 10_000 }, async t => {
  for (const shutdown of [false, true]) {
    await t.test(shutdown ? 'shutdown' : 'disconnect', { timeout: 10_000 }, async t => {
      let started!: () => void;
      const ready = new Promise<void>(resolve => { started = resolve; });
      let closed!: Promise<unknown>;
      const s = await stack(t, async (req, res) => {
        req.resume(); closed = once(res, 'close'); started();
      });
      const abort = new AbortController();
      const pending = fetch(s.gateway.url, {
        method: 'POST', headers: { ...headers, authorization: `Bearer ${s.viewer}` },
        body: JSON.stringify(call('trigger_refund', refund)), signal: abort.signal,
      }).catch(() => undefined);
      await ready;
      if (shutdown) await s.gateway.close();
      else abort.abort();
      await pending; await closed;
      assert.equal(s.forwarded(), 1);
    });
  }
});

test('audit write failure fails closed without forwarding or leaking database details', { timeout: 10_000 }, async t => {
  const s = await stack(t);
  const db = new DatabaseSync(s.auditPath);
  db.exec("CREATE TRIGGER fail_denial BEFORE INSERT ON gateway_denials BEGIN SELECT RAISE(ABORT, 'secret_internal_database_detail'); END;");
  const res = await s.post(call('admin_health_check'));
  assert.equal(res.status, 502);
  assert.doesNotMatch(await res.text(), /secret_internal|INSERT|stack/);
  assert.equal(s.forwarded(), 0);
  db.close();
});
