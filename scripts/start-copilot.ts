import { randomBytes } from 'node:crypto';
import { CustomerStore } from '../src/customer/store.js';
import { GatewayAudit } from '../src/gateway/audit.js';
import { startCustomerHttp } from '../src/mcp/http.js';
import { startGateway } from '../src/gateway/server.js';
import { startCopilot } from '../src/copilot/server.js';
import { GroqProvider } from '../src/copilot/groq.js';
import { livePolicy } from '../src/copilot/generation.js';
import { TokenBudget } from '../src/resilience/budget.js';

async function main() {
  const port = Number(process.env.BRIDGELAYER_COPILOT_PORT ?? 3040);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid demo port');
  const apiKey = process.env.GROQ_API_KEY?.trim();
  const provider = apiKey ? new GroqProvider({ apiKey, ...(process.env.GROQ_MODEL ? { model: process.env.GROQ_MODEL } : {}) }) : undefined;
  const budget = provider ? new TokenBudget('data/copilot-budget.sqlite', { tokens: livePolicy.tokens }) : undefined;
  const store = new CustomerStore(':memory:'); const audit = new GatewayAudit(':memory:');
  const jwtSecret = randomBytes(32).toString('hex'); const serviceKey = randomBytes(32).toString('hex');
  let customer: Awaited<ReturnType<typeof startCustomerHttp>> | undefined;
  let gateway: Awaited<ReturnType<typeof startGateway>> | undefined;
  let copilot: Awaited<ReturnType<typeof startCopilot>> | undefined;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    await copilot?.close(); await gateway?.close(); await customer?.close(); budget?.close(); audit.close(); store.close();
  })();
  try {
    customer = await startCustomerHttp({ store, serviceKey });
    gateway = await startGateway({ downstreamUrl: customer.url, serviceKey, jwtSecret, audit });
    copilot = await startCopilot({ gatewayUrl: gateway.url, jwtSecret, port, ...(provider && budget ? { live: { provider, budget } } : {}) });
    console.log(`BridgeLayer Support Copilot: ${copilot.url}\nFictional data. Scripted mode available.\n` +
      (provider ? `Live AI configured: Groq / ${provider.model}. Keep your Groq account on the Free plan.\n` : 'Live AI unavailable: set GROQ_API_KEY in .env and restart to enable it.\n') + 'Press Ctrl+C to stop.');
    const stop = () => { void close().catch(() => { process.exitCode = 1; }); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch (error) { await close(); throw error; }
}
main().catch(() => { console.error('Could not start the Copilot demo. Check the configured port and build.'); process.exitCode = 1; });
