import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { startGateway } from '../src/gateway/server.js';
import { GatewayAudit } from '../src/gateway/audit.js';
import { issueDemoToken } from '../src/gateway/auth.js';
import { TokenBudget } from '../src/resilience/budget.js';
import { modelMock } from '../src/resilience/mock.js';
import type { ModelProvider } from '../src/resilience/provider.js';
import { frame } from '../src/streaming/provider.js';
import type { LogEvent } from '../src/logger.js';

async function stack(t: TestContext, primary: ModelProvider = modelMock()) {
  const budget = new TokenBudget(':memory:'); const audit = new GatewayAudit(':memory:');
  const jwtSecret = randomBytes(32).toString('hex'); const serviceKey = randomBytes(32).toString('hex');
  const events: LogEvent[] = []; let starts = 0;
  const gateway = await startGateway({ downstreamUrl: 'http://127.0.0.1:1/mcp', jwtSecret, serviceKey, audit, budget,
    primaryModel: { open(input) { starts++; return primary.open(input); } }, logger: event => events.push(event) });
  t.after(async () => { await gateway.close(); budget.close(); audit.close(); });
  const token = (tenant: string, sub = 'viewer', role: 'viewer' | 'admin' = 'viewer') => issueDemoToken(jwtSecret, { role, sub, tenant_id: tenant });
  const url = new URL('/resilient/stream', gateway.url);
  const post = (value: unknown, bearer: string) => fetch(url, { method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, accept: 'text/event-stream', 'content-type': 'application/json' }, body: JSON.stringify(value) });
  return { budget, gateway, token, post, url, events, starts: () => starts, jwtSecret, serviceKey };
}

test('HTTP tenant budget comes only from JWT; shared tenant identities share limits and other tenants are independent', { timeout: 10_000 }, async t => {
  const s = await stack(t); const first = await s.token('one'); const second = await s.token('one', 'admin', 'admin');
  const other = await s.token('two');
  const id = s.budget.reserve('one', 50_000, 'primary'); s.budget.settle(id, { input: 50_000, output: 0 });
  for (const bearer of [first, second]) {
    const res = await s.post({ fixture: 'plain' }, bearer); assert.equal(res.status, 429);
    assert.deepEqual(await res.json(), { error: { code: 'BUDGET_EXHAUSTED' } });
  }
  assert.equal(s.starts(), 0);
  const spoofed = await s.post({ fixture: 'plain', tenant_id: 'two' }, first); assert.equal(spoofed.status, 400); await spoofed.text();
  const allowed = await s.post({ fixture: 'split-email' }, other); assert.equal(allowed.status, 200);
  const output = await allowed.text(); assert.match(output, /REDACTED_EMAIL/); assert.doesNotMatch(output, /alex|example/);
  assert.equal(s.budget.status('two').used, 40); assert.equal(s.starts(), 1);
});

test('HTTP fallback succeeds once, unknown usage is charged, and failure after output cannot change models', { timeout: 10_000 }, async t => {
  const s = await stack(t); const bearer = await s.token('tenant');
  const success = await s.post({ fixture: 'split-email', scenario: 'primary-429' }, bearer);
  assert.equal(success.status, 200); const output = await success.text();
  assert.match(output, /REDACTED_EMAIL/); assert.equal(output.match(/event: done/g)?.length, 1);
  assert.equal(s.budget.status('tenant').used, 50);
  const unknown = await s.post({ fixture: 'plain', scenario: 'unknown-usage' }, bearer);
  assert.equal(unknown.status, 200); await unknown.text(); assert.equal(s.budget.status('tenant').used, 434);
  const late = await s.post({ fixture: 'plain', scenario: 'after-output' }, bearer);
  assert.equal(late.status, 200); const failed = await late.text();
  assert.match(failed, /event: error/); assert.doesNotMatch(failed, /event: done/);
  assert.equal(s.budget.status('tenant').used, 818);
  const both = await s.post({ fixture: 'plain', scenario: 'backup-failure' }, bearer);
  assert.equal(both.status, 502); await both.text(); assert.equal(s.budget.status('tenant').used, 1202);
  const logs = JSON.stringify(s.events);
  for (const secret of [bearer, s.jwtSecret, s.serviceKey, 'tenant', 'alex@example']) assert.ok(!logs.includes(secret));
  assert.ok(s.events.every(e => e.event === 'resilience.request'));
});

test('invalid auth/body cannot reserve budget or dispatch a provider', { timeout: 10_000 }, async t => {
  const s = await stack(t);
  const missing = await fetch(s.url, { method: 'POST' }); assert.equal(missing.status, 401); await missing.text();
  const invalid = await s.post({ fixture: 'plain' }, 'invalid'); assert.equal(invalid.status, 401); await invalid.text();
  const bearer = await s.token('tenant');
  for (const body of [{ fixture: 'plain', tokens: 0 }, { fixture: 'plain', scenario: 'arbitrary' }, { fixture: 'plain', tenant: 'other' }]) {
    const res = await s.post(body, bearer); assert.equal(res.status, 400); await res.text();
  }
  assert.equal(s.starts(), 0); assert.equal(s.budget.status('tenant').used, 0);
});

test('gateway shutdown awaits final unknown-usage settlement before database shutdown', { timeout: 10_000 }, async t => {
  const primary: ModelProvider = { open({ signal }) { return { usage: () => undefined, bytes: (async function* () {
    yield Buffer.from(frame('delta', { text: 'safe ' }));
    await new Promise<void>((_, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  })() }; } };
  const s = await stack(t, primary); const response = await s.post({ fixture: 'plain' }, await s.token('tenant'));
  await s.gateway.close(); await response.body!.cancel().catch(() => {});
  assert.equal(s.budget.status('tenant').used, 384);
  assert.equal(s.events.length, 1); assert.equal(s.events[0]!.outcome, 'cancelled');
});

test('over-reported usage is charged and terminates the stream without a success marker', { timeout: 10_000 }, async t => {
  for (const usage of [{ input: 100, output: 500 }, { input: 0, output: 257 }, { input: 129, output: 0 }]) {
    const primary: ModelProvider = { open() { return { usage: () => usage, bytes: (async function* () {
      yield Buffer.from(frame('delta', { text: 'safe ' }) + frame('done', {}));
    })() }; } };
    const s = await stack(t, primary); const res = await s.post({ fixture: 'plain' }, await s.token('tenant'));
    assert.equal(res.status, 200); const output = await res.text();
    assert.match(output, /USAGE_INVALID/); assert.doesNotMatch(output, /event: done/);
    assert.equal(s.budget.status('tenant').used, usage.input + usage.output);
  }
});
