import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { CustomerStore } from '../src/customer/store.js';
import { GatewayAudit } from '../src/gateway/audit.js';
import { issueDemoToken } from '../src/gateway/auth.js';
import { startCustomerHttp } from '../src/mcp/http.js';
import { startGateway } from '../src/gateway/server.js';
import { startCopilot } from '../src/copilot/server.js';
import { scriptedDraft } from '../src/copilot/scripted.js';
import type { DraftSource } from '../src/copilot/workflow.js';
import { frame } from '../src/streaming/provider.js';
import type { LogEvent } from '../src/logger.js';

const valid = { customerId: 'CUST-00001', caseType: 'account', issue: 'Please help me understand my current account plan.', includeSampleEmail: true };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { resolve, promise }; }
function parse(body: string) {
  return body.trim().split('\n\n').filter(Boolean).map(block => {
    const [event, data] = block.split('\n');
    return { type: event!.slice(7), data: JSON.parse(data!.slice(6)) as Record<string, unknown> };
  });
}
async function stack(t: TestContext, source: DraftSource = (customer, input) => scriptedDraft(customer, input, 0)) {
  const store = new CustomerStore(':memory:'); const audit = new GatewayAudit(':memory:');
  const jwtSecret = randomBytes(32).toString('hex'); const serviceKey = randomBytes(32).toString('hex');
  const logs: LogEvent[] = []; let starts = 0;
  const customer = await startCustomerHttp({ store, serviceKey });
  const gateway = await startGateway({ downstreamUrl: customer.url, jwtSecret, serviceKey, audit, logger: event => logs.push(event) });
  const copilot = await startCopilot({ gatewayUrl: gateway.url, jwtSecret, logger: event => logs.push(event),
    source: (record, input) => { starts++; assert.ok(!('email' in record)); return source(record, input); },
  });
  t.after(async () => { await copilot.close(); await gateway.close(); await customer.close(); audit.close(); store.close(); });
  const origin = new URL(copilot.url).origin;
  const session = await fetch(new URL('/api/session', copilot.url), { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(session.status, 200); assert.deepEqual(await session.json(), { mode: 'scripted', expiresIn: 900 });
  const setCookie = session.headers.get('set-cookie')!; const cookie = setCookie.split(';')[0]!;
  const post = (body: unknown = valid, extra: Record<string, string> = {}) => fetch(new URL('/copilot/draft', copilot.url), {
    method: 'POST', headers: { origin, cookie, 'content-type': 'application/json', accept: 'text/event-stream', ...extra }, body: JSON.stringify(body),
  });
  return { copilot, gateway, customer, cookie, setCookie, origin, post, logs, starts: () => starts, jwtSecret, store };
}

test('Copilot serves the local workbench and fixes the browser session to a demo viewer', async t => {
  const s = await stack(t);
  assert.match(s.setCookie, /HttpOnly/); assert.match(s.setCookie, /SameSite=Strict/); assert.match(s.setCookie, /Max-Age=900/);
  const page = await fetch(s.copilot.url); assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  const html = await page.text(); assert.match(html, /Yu-Chen Su/); assert.match(html, /Scripted demo/);
  assert.doesNotMatch(html, /Bearer |eyJ/);
  for (const path of ['/app.js', '/styles.css']) {
    const response = await fetch(new URL(path, s.copilot.url)); assert.equal(response.status, 200); assert.ok((await response.text()).length > 100);
  }
  const catalog = await fetch(new URL('/api/catalog', s.copilot.url), { headers: { cookie: s.cookie } });
  assert.equal(catalog.status, 200); const data = await catalog.json() as { customers: unknown[]; cases: unknown[]; mode: string };
  assert.equal(data.mode, 'scripted'); assert.equal(data.customers.length, 3); assert.equal(data.cases.length, 3);
  assert.equal(s.starts(), 0);
});

test('Copilot performs real gateway lookup, redacts split emails and reports actual metrics', async t => {
  const s = await stack(t);
  const response = await s.post({ ...valid, customerId: 'CUST-00002', issue: 'Contact another@example.com about my current plan, please.' });
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type')!, /text\/event-stream/);
  const body = await response.text(); const events = parse(body);
  assert.deepEqual(events.slice(0, 3).map(e => e.type), ['status', 'customer', 'status']);
  assert.deepEqual(events[1]!.data, { customer_id: 'CUST-00002', name: 'Sam Chen', plan: 'Starter' });
  const output = events.filter(e => e.type === 'delta').map(e => e.data.text).join('');
  assert.match(output, /Sam Chen/); assert.match(output, /Starter/); assert.match(output, /REDACTED_EMAIL/);
  assert.doesNotMatch(body, /sam@example|another@example|support@example/);
  const metrics = events.find(e => e.type === 'metrics')!.data;
  assert.equal(metrics.redactions, 2); assert.equal(metrics.outputBytes, Buffer.byteLength(output));
  assert.equal(events.at(-1)!.type, 'done'); assert.equal(events.filter(e => e.type === 'done').length, 1);
  assert.ok(s.logs.some(e => e.event === 'gateway.request' && e.outcome === 'success'));
  assert.equal(s.starts(), 1);
  assert.equal((s.store.db.prepare('SELECT count(*) AS total FROM refunds').get() as { total: number }).total, 0);
  const logs = JSON.stringify(s.logs); assert.doesNotMatch(logs, /Sam Chen|another@example|support@example|eyJ/); assert.ok(!logs.includes(s.jwtSecret));
});

test('Copilot validates auth, origin, body and requested fields before opening a source', async t => {
  const s = await stack(t);
  for (const [extra, status] of [
    [{ cookie: '' }, 401], [{ cookie: 'bridgelayer_demo=invalid' }, 401], [{ origin: 'https://evil.example' }, 403],
    [{ origin: '' }, 403], [{ accept: 'text/event-stream;q=0' }, 406], [{ 'content-type': 'text/plain' }, 415],
    [{ 'content-encoding': 'gzip' }, 415],
  ] as const) { const r = await s.post(valid, extra); assert.equal(r.status, status); await r.text(); }
  const admin = await issueDemoToken(s.jwtSecret, { sub: 'copilot-demo', tenant_id: 'copilot-demo', role: 'admin' });
  assert.equal((await s.post(valid, { cookie: `bridgelayer_demo=${admin}` })).status, 401);
  for (const body of [{ ...valid, tenant_id: 'other' }, { ...valid, role: 'admin' }, { ...valid, customerId: '../secret' },
    { ...valid, caseType: 'refund' }, { ...valid, issue: 'short' }, { ...valid, issue: 'x'.repeat(1201) }, { ...valid, issue: '\ud800'.repeat(20) }, null, []]) {
    const response = await s.post(body); assert.equal(response.status, 400); await response.text();
  }
  assert.equal((await s.post({ ...valid, issue: 'x'.repeat(9000) })).status, 413);
  const malformed = await fetch(new URL('/copilot/draft', s.copilot.url), { method: 'POST', headers: {
    origin: s.origin, cookie: s.cookie, 'content-type': 'application/json', accept: 'text/event-stream',
  }, body: '{private@example.com' });
  assert.equal(malformed.status, 400); assert.doesNotMatch(await malformed.text(), /private@example/);
  const bootstrap = await fetch(new URL('/api/session', s.copilot.url), { method: 'POST', headers: { origin: s.origin, 'content-type': 'application/json' }, body: '{"role":"admin"}' });
  assert.equal(bootstrap.status, 400);
  const unauthenticated = await fetch(new URL('/api/catalog', s.copilot.url)); assert.equal(unauthenticated.status, 401);
  const traversal = await fetch(new URL('/src/copilot/server.ts', s.copilot.url)); assert.equal(traversal.status, 404);
  const hostile = await new Promise<number | undefined>((resolve, reject) => {
    const req = httpRequest(s.copilot.url, { headers: { host: 'evil.example' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); req.on('error', reject); req.end();
  }); assert.equal(hostile, 403); assert.equal(s.starts(), 0);
});

test('unknown customers and unavailable gateway fail without scripted success', async t => {
  const s = await stack(t);
  const missing = parse(await (await s.post({ ...valid, customerId: 'CUST-99999' })).text());
  assert.equal(missing.at(-1)!.data.code, 'CUSTOMER_NOT_FOUND'); assert.ok(!missing.some(e => e.type === 'delta' || e.type === 'done'));
  await s.gateway.close();
  const failed = parse(await (await s.post()).text()); assert.equal(failed.at(-1)!.data.code, 'CUSTOMER_LOOKUP_FAILED');
  assert.equal(s.starts(), 0);
});

test('failed streams keep unresolved email private and a new request has fresh state', async t => {
  let calls = 0;
  const s = await stack(t, () => ({ async *open() {
    calls++;
    if (calls === 1) { yield Buffer.from(frame('delta', { text: 'Hello pending@example.com' })); throw new Error('private provider secret'); }
    yield Buffer.from(frame('delta', { text: 'Fresh response' }) + frame('done', {}));
  } }));
  const failed = await (await s.post()).text();
  assert.match(failed, /event: error/); assert.doesNotMatch(failed, /pending|example.com|provider secret|event: done/);
  const recovered = await (await s.post()).text(); assert.match(recovered, /event: done/); assert.doesNotMatch(recovered, /REDACTED|pending/);
});

test('four draft slots are bounded, disconnect cancels a source, and a slot can be reused', { timeout: 10_000 }, async t => {
  const ready = deferred(); const stopped = deferred(); let starts = 0;
  const s = await stack(t, () => ({ async *open({ signal }) {
    starts++; const index = starts;
    if (starts === 4) ready.resolve();
    if (index <= 4) {
      try { await delay(60_000, undefined, { signal }); }
      finally { if (index === 1) stopped.resolve(); }
    }
    yield Buffer.from(frame('delta', { text: 'Recovered ' }) + frame('done', {}));
  } }));
  const requests = await Promise.all(Array.from({ length: 4 }, () => s.post()));
  await ready.promise;
  const excess = await s.post(); assert.equal(excess.status, 503); await excess.text();
  for (const response of requests) await response.body!.cancel();
  await stopped.promise;
  // Cancellation completion includes the HTTP finally block that releases admission slots.
  for (let i = 0; i < 100 && s.logs.filter(e => e.event === 'copilot.request' && e.outcome === 'cancelled').length < 4; i++) await delay(5);
  const recovered = await s.post(); assert.equal(recovered.status, 200); assert.match(await recovered.text(), /event: done/);
});

test('closing Copilot cancels in-flight generation before closing the stack', { timeout: 10_000 }, async t => {
  const started = deferred(); const stopped = deferred();
  const s = await stack(t, () => ({ async *open({ signal }) {
    try { started.resolve(); await delay(60_000, undefined, { signal }); }
    finally { stopped.resolve(); }
    yield Buffer.from(frame('done', {}));
  } }));
  const response = await s.post(); await started.promise;
  await s.copilot.close(); await stopped.promise; await response.body?.cancel().catch(() => {});
});

test('customer context and guardrail state stay separate across concurrent drafts', async t => {
  const s = await stack(t);
  const [alex, jordan] = await Promise.all([
    s.post({ ...valid, includeSampleEmail: false }).then(r => r.text()),
    s.post({ ...valid, customerId: 'CUST-00003', caseType: 'billing' }).then(r => r.text()),
  ]);
  const first = parse(alex); const second = parse(jordan);
  const text = (events: ReturnType<typeof parse>) => events.filter(e => e.type === 'delta').map(e => e.data.text).join('');
  assert.match(text(first), /Alex Rivera/); assert.doesNotMatch(text(first), /Jordan|REDACTED/);
  assert.match(text(second), /Jordan Taylor/); assert.match(text(second), /Team/); assert.match(text(second), /does not.*approve a refund/s);
  assert.equal(first.find(e => e.type === 'metrics')!.data.redactions, 0);
  assert.equal(second.find(e => e.type === 'metrics')!.data.redactions, 1);
});
