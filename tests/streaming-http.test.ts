import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { request } from 'node:http';
import { SignJWT } from 'jose';
import { CustomerStore } from '../src/customer/store.js';
import { GatewayAudit } from '../src/gateway/audit.js';
import { startCustomerHttp } from '../src/mcp/http.js';
import { startGateway } from '../src/gateway/server.js';
import { DEMO_AUDIENCE, DEMO_ISSUER, issueDemoToken } from '../src/gateway/auth.js';
import { frame, type Provider } from '../src/streaming/provider.js';
import { mockProvider } from '../src/streaming/mock.js';
import { limits, type Schedule } from '../src/streaming/contracts.js';
import type { LogEvent } from '../src/logger.js';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function stack(t: TestContext, provider: Provider = mockProvider(), schedule?: Schedule) {
  const store = new CustomerStore(':memory:'); const audit = new GatewayAudit(':memory:');
  const jwtSecret = randomBytes(32).toString('hex'); const serviceKey = randomBytes(32).toString('hex');
  const events: LogEvent[] = []; let starts = 0;
  const customer = await startCustomerHttp({ store, serviceKey });
  const gateway = await startGateway({ jwtSecret, serviceKey, audit, downstreamUrl: customer.url,
    logger: event => events.push(event),
    streamProvider: { open(input) { starts++; return provider.open(input); } },
    ...(schedule ? { streamSchedule: schedule } : {}),
  });
  t.after(async () => { await gateway.close(); await customer.close(); audit.close(); store.close(); });
  const viewer = await issueDemoToken(jwtSecret, { sub: 'viewer', role: 'viewer', tenant_id: 'demo' });
  const admin = await issueDemoToken(jwtSecret, { sub: 'admin', role: 'admin', tenant_id: 'demo' });
  const url = new URL('/guardrails/stream', gateway.url).href;
  const post = (body: unknown = { fixture: 'split-email' }, token = viewer, extra: Record<string, string> = {}) => fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream', authorization: `Bearer ${token}`, ...extra },
    body: JSON.stringify(body),
  });
  return { gateway, url, viewer, admin, jwtSecret, serviceKey, post, events, starts: () => starts };
}

test('authenticated real HTTP streaming redacts email; roles and concurrent state stay independent', { timeout: 10_000 }, async t => {
  const s = await stack(t);
  const responses = await Promise.all([
    s.post({ fixture: 'split-email' }), s.post({ fixture: 'plain' }, s.admin),
    s.post({ fixture: 'email-heavy' }), s.post({ fixture: 'long-token' }),
  ]);
  const bodies = await Promise.all(responses.map(res => res.text()));
  for (const res of responses) {
    assert.equal(res.status, 200); assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
    assert.match(res.headers.get('x-request-id') ?? '', /^[a-f0-9-]{36}$/);
  }
  assert.equal(new Set(responses.map(res => res.headers.get('x-request-id'))).size, 4);
  assert.match(bodies[0]!, /REDACTED_EMAIL/); assert.doesNotMatch(bodies[0]!, /alex|example|support/);
  assert.doesNotMatch(bodies[1]!, /REDACTED/); assert.match(bodies[1]!, /世界/);
  assert.equal(bodies[2]!.match(/REDACTED_EMAIL/g)?.length, 3);
  assert.match(bodies[3]!, /REDACTED_OVERSIZE/);
  for (const body of bodies) assert.equal(body.match(/event: done/g)?.length, 1);
  const logs = JSON.stringify(s.events);
  for (const value of [s.viewer, s.admin, s.jwtSecret, s.serviceKey, 'alex', 'example.com']) assert.ok(!logs.includes(value));
  assert.ok(s.events.every(event => event.event === 'stream.request' && typeof event.peak_token_bytes === 'number'));
});

test('invalid credentials, hostile headers and malformed requests never start the provider', { timeout: 10_000 }, async t => {
  const s = await stack(t);
  const expired = await new SignJWT({ role: 'viewer', tenant_id: 'demo' }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(DEMO_ISSUER).setAudience(DEMO_AUDIENCE).setSubject('expired').setIssuedAt(1).setExpirationTime(2)
    .sign(new TextEncoder().encode(s.jwtSecret));
  for (const token of ['', 'invalid', expired]) {
    const res = await s.post({}, token); assert.equal(res.status, 401);
    assert.match(res.headers.get('www-authenticate') ?? '', /Bearer/); await res.text();
  }
  assert.equal((await fetch(s.url, { method: 'POST' })).status, 401);
  for (const [extra, status] of [
    [{ origin: 'https://evil.example' }, 403], [{ 'content-type': 'text/plain' }, 415],
    [{ 'content-encoding': 'gzip' }, 415], [{ accept: 'text/event-stream;q=0' }, 406],
    [{ accept: 'text/event-stream-evil' }, 406],
  ] as const) {
    const res = await s.post({ fixture: 'plain' }, s.viewer, extra); assert.equal(res.status, status); await res.text();
  }
  for (const body of [{ fixture: 'unknown' }, { fixture: 'plain', prompt: 'private' }, [], null]) {
    const res = await s.post(body); assert.equal(res.status, 400); assert.doesNotMatch(await res.text(), /private/);
  }
  const large = await s.post({ fixture: 'x'.repeat(4096) }); assert.equal(large.status, 413); await large.text();
  const wrongMethod = await fetch(s.url, { headers: { authorization: `Bearer ${s.viewer}` } });
  assert.equal(wrongMethod.status, 405); await wrongMethod.text();
  const hostile = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(s.url, { method: 'POST', headers: { host: 'evil.example' } }, res => { res.resume(); res.once('end', () => resolve(res.statusCode)); });
    req.once('error', reject); req.end();
  });
  assert.equal(hostile, 403);
  assert.equal(s.starts(), 0);
});

test('provider failure before first output uses JSON; later failure emits sanitized error without pending text', { timeout: 10_000 }, async t => {
  const bad: Provider = { async *open() { throw new Error('private alex@example.com'); } };
  const s = await stack(t, bad);
  const response = await s.post(); assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: { code: 'INVALID_STREAM' } });
  const normal = await stack(t);
  for (const fixture of ['malformed', 'truncated']) {
    const res = await normal.post({ fixture }); assert.equal(res.status, 200);
    const output = await res.text();
    assert.match(output, /event: error/); assert.doesNotMatch(output, /event: done|alex|example|broken/);
  }
});

test('four-stream cap, injected read deadline, and slot recovery', { timeout: 10_000 }, async t => {
  const allStarted = deferred(); let starts = 0;
  const tasks = new Set<{ fn: () => void; ms: number }>();
  const schedule: Schedule = (fn, ms) => { const task = { fn, ms }; tasks.add(task); return () => { tasks.delete(task); }; };
  const provider: Provider = { async *open({ signal }) {
    starts++;
    if (starts <= 4) {
      if (starts === 4) allStarted.resolve();
      await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    }
    yield Buffer.from(frame('delta', { text: 'recovered' }) + frame('done', {}));
  } };
  const s = await stack(t, provider, schedule);
  const pending = Array.from({ length: 4 }, () => s.post({ fixture: 'plain' }));
  await allStarted.promise;
  const excess = await s.post(); assert.equal(excess.status, 503); await excess.text(); assert.equal(s.starts(), 4);
  for (const task of [...tasks]) if (task.ms === limits.readMs) task.fn();
  for (const res of await Promise.all(pending)) { assert.equal(res.status, 504); await res.text(); }
  const recovered = await s.post(); assert.equal(recovered.status, 200); assert.match(await recovered.text(), /recovered/);
  assert.equal(tasks.size, 0);
});

test('client cancellation and gateway shutdown abort the provider and release its iterator', { timeout: 10_000 }, async t => {
  for (const mode of ['disconnect', 'shutdown'] as const) {
    const stopped = deferred(); const waiting = deferred(); let closed = 0;
    const provider: Provider = { async *open({ signal }) {
      try {
        yield Buffer.from(frame('delta', { text: 'safe ' }));
        waiting.resolve();
        await new Promise<void>((_, reject) => {
          if (signal.aborted) { reject(signal.reason); return; }
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      } finally { closed++; stopped.resolve(); }
    } };
    const s = await stack(t, provider);
    const response = await s.post(); await waiting.promise;
    if (mode === 'disconnect') await response.body!.cancel();
    else { await s.gateway.close(); await response.body!.cancel().catch(() => {}); }
    await stopped.promise; assert.equal(closed, 1);
  }
});

test('audit failure fails closed on streaming auth and malformed JSON stays sanitized', { timeout: 10_000 }, async t => {
  const s = await stack(t);
  const res = await fetch(s.url, { method: 'POST', headers: {
    authorization: `Bearer ${s.viewer}`, 'content-type': 'application/json', accept: 'text/event-stream',
  }, body: '{private alex@example.com' });
  assert.equal(res.status, 400); assert.doesNotMatch(await res.text(), /private|alex|example/);
  const audit = new GatewayAudit(':memory:'); audit.close();
  const gateway = await startGateway({ jwtSecret: s.jwtSecret, serviceKey: s.serviceKey, audit,
    downstreamUrl: 'http://127.0.0.1:1/mcp', logger: () => {},
    streamProvider: { open() { throw new Error('must not run'); } },
  });
  t.after(() => gateway.close());
  const rejected = await fetch(new URL('/guardrails/stream', gateway.url), { method: 'POST' });
  assert.equal(rejected.status, 502); assert.deepEqual(await rejected.json(), { error: { code: 'STREAM_FAILED' } });
  assert.equal(s.starts(), 0);
});
