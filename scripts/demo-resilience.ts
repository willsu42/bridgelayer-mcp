import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { GatewayAudit } from '../src/gateway/audit.js';
import { issueDemoToken } from '../src/gateway/auth.js';
import { startGateway } from '../src/gateway/server.js';
import { TokenBudget } from '../src/resilience/budget.js';
import { ByteDecoder } from '../src/streaming/decoder.js';
import { EventParser } from '../src/streaming/sse.js';
import { metrics } from '../src/streaming/contracts.js';

const budget = new TokenBudget(':memory:'); const audit = new GatewayAudit(':memory:');
const jwtSecret = randomBytes(32).toString('hex'); const serviceKey = randomBytes(32).toString('hex');
let gateway: Awaited<ReturnType<typeof startGateway>> | undefined;
try {
  // This demo exercises only the in-process model mocks; the MCP downstream is unused.
  gateway = await startGateway({ jwtSecret, serviceKey, audit, budget, downstreamUrl: 'http://127.0.0.1:1/mcp' });
  const url = new URL('/resilient/stream', gateway.url);
  const token = await issueDemoToken(jwtSecret, { sub: 'demo', role: 'viewer', tenant_id: 'demo' });
  const post = (body: unknown, bearer = token) => fetch(url, { method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  for (const [scenario, expectedUsed, terminal] of [
    ['normal', 40, 'done'], ['primary-429', 90, 'done'], ['primary-timeout', 524, 'done'],
    ['after-output', 908, 'error'], ['backup-failure', 1292, 'json-error'], ['unknown-usage', 1676, 'done'],
  ] as const) {
    const response = await post({ fixture: 'split-email', scenario });
    let output = ''; let last = '';
    if (response.status === 502) { assert.equal(terminal, 'json-error'); await response.json(); last = 'json-error'; }
    else {
      assert.equal(response.status, 200);
      const decoder = new ByteDecoder(); const parser = new EventParser(metrics());
      for await (const bytes of response.body!) {
        for (const event of parser.push(decoder.decode(bytes))) {
          if (event.event === 'delta') output += (JSON.parse(event.data) as { text: string }).text;
          else last = event.event;
        }
      }
      decoder.decode();
    }
    assert.equal(last, terminal); assert.doesNotMatch(output, /alex|example/);
    if (terminal === 'done') assert.equal(output, 'Contact [REDACTED_EMAIL] for help.');
    assert.equal(budget.status('demo').used, expectedUsed);
    console.log(`${scenario}: ${last}; simulated usage charged so far: ${expectedUsed}`);
    if (output) console.log(output);
  }
  const depleted = await issueDemoToken(jwtSecret, { sub: 'other', role: 'viewer', tenant_id: 'depleted' });
  budget.settle(budget.reserve('depleted', 50_000, 'primary'), { input: 50_000, output: 0 });
  const denied = await post({ fixture: 'plain' }, depleted); assert.equal(denied.status, 429); await denied.text();
  assert.equal(budget.status('demo').used, 1676);
  console.log('Separate depleted tenant: HTTP 429; original tenant retains its own budget.');
} finally { await gateway?.close(); budget.close(); audit.close(); }
