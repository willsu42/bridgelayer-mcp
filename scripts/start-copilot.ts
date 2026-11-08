import { randomBytes } from 'node:crypto';
import { CustomerStore } from '../src/customer/store.js';
import { GatewayAudit } from '../src/gateway/audit.js';
import { startCustomerHttp } from '../src/mcp/http.js';
import { startGateway } from '../src/gateway/server.js';
import { startCopilot } from '../src/copilot/server.js';

async function main() {
  const port = Number(process.env.BRIDGELAYER_COPILOT_PORT ?? 3040);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid demo port');
  const store = new CustomerStore(':memory:'); const audit = new GatewayAudit(':memory:');
  const jwtSecret = randomBytes(32).toString('hex'); const serviceKey = randomBytes(32).toString('hex');
  let customer: Awaited<ReturnType<typeof startCustomerHttp>> | undefined;
  let gateway: Awaited<ReturnType<typeof startGateway>> | undefined;
  let copilot: Awaited<ReturnType<typeof startCopilot>> | undefined;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    await copilot?.close(); await gateway?.close(); await customer?.close(); audit.close(); store.close();
  })();
  try {
    customer = await startCustomerHttp({ store, serviceKey });
    gateway = await startGateway({ downstreamUrl: customer.url, serviceKey, jwtSecret, audit });
    copilot = await startCopilot({ gatewayUrl: gateway.url, jwtSecret, port });
    console.log(`BridgeLayer Support Copilot: ${copilot.url}\nScripted demo. Fictional data. No model API key needed.\nPress Ctrl+C to stop.`);
    const stop = () => { void close().catch(() => { process.exitCode = 1; }); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch (error) { await close(); throw error; }
}
main().catch(() => { console.error('Could not start the Copilot demo. Check the configured port and build.'); process.exitCode = 1; });
