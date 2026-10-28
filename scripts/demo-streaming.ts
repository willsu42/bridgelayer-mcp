import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { CustomerStore } from '../src/customer/store.js';
import { GatewayAudit } from '../src/gateway/audit.js';
import { issueDemoToken } from '../src/gateway/auth.js';
import { startGateway } from '../src/gateway/server.js';
import { startCustomerHttp } from '../src/mcp/http.js';
import { ByteDecoder } from '../src/streaming/decoder.js';
import { EventParser } from '../src/streaming/sse.js';
import { metrics } from '../src/streaming/contracts.js';

const store = new CustomerStore(':memory:');
const audit = new GatewayAudit(':memory:');
const jwtSecret = randomBytes(32).toString('hex');
const serviceKey = randomBytes(32).toString('hex');
let customer: Awaited<ReturnType<typeof startCustomerHttp>> | undefined;
let gateway: Awaited<ReturnType<typeof startGateway>> | undefined;
try {
  customer = await startCustomerHttp({ store, serviceKey });
  gateway = await startGateway({ downstreamUrl: customer.url, serviceKey, jwtSecret, audit });
  const url = new URL('/guardrails/stream', gateway.url);
  const token = await issueDemoToken(jwtSecret, { role: 'viewer', sub: 'stream-demo', tenant_id: 'demo' });
  for (const [fixture, expected] of [
    ['split-email', 'Contact [REDACTED_EMAIL] for help.'],
    ['long-token', '[REDACTED_OVERSIZE] safe again.'],
    ['malformed', 'Safe text. '],
  ] as const) {
    const response = await fetch(url, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ fixture }),
    });
    assert.equal(response.status, 200);
    const decoder = new ByteDecoder(); const parser = new EventParser(metrics());
    let text = ''; let completion = ''; let terminalEvents = 0;
    for await (const chunk of response.body!) {
      for (const event of parser.push(decoder.decode(chunk))) {
        if (event.event === 'delta') {
          const delta = (JSON.parse(event.data) as { text: string }).text;
          text += delta; process.stdout.write(delta);
        } else { completion = event.event; terminalEvents++; }
      }
    }
    decoder.decode();
    assert.equal(text, expected);
    assert.equal(completion, fixture === 'malformed' ? 'error' : 'done');
    assert.equal(terminalEvents, 1);
    console.log(`\n${fixture}: ${completion}`);
  }
  assert.equal((await fetch(url, { method: 'POST' })).status, 401);
  console.log('Missing JWT: HTTP 401. No live provider or customer writes.');
} finally {
  await gateway?.close(); await customer?.close(); audit.close(); store.close();
}
