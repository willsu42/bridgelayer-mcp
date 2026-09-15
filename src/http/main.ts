import { resolve } from 'node:path';
import { CustomerStore } from '../customer/store.js';
import { GatewayAudit } from '../gateway/audit.js';
import { secretBytes } from '../gateway/auth.js';
import { startGateway } from '../gateway/server.js';
import { startCustomerHttp } from '../mcp/http.js';
import { log } from '../logger.js';

function credential(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  secretBytes(value);
  return value;
}
function port(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('Invalid port');
  return value;
}

async function main() {
  const jwtSecret = credential('BRIDGELAYER_JWT_SECRET');
  const serviceKey = credential('BRIDGELAYER_SERVICE_KEY');
  if (jwtSecret === serviceKey) throw new Error('Credentials must differ');
  const store = new CustomerStore(process.env.SUPPORTBRIDGE_DB ?? resolve('data/supportbridge.sqlite'));
  let audit: GatewayAudit | undefined;
  let customer: Awaited<ReturnType<typeof startCustomerHttp>> | undefined;
  let gateway: Awaited<ReturnType<typeof startGateway>> | undefined;
  try {
    audit = new GatewayAudit(process.env.BRIDGELAYER_AUDIT_DB ?? resolve('data/gateway-audit.sqlite'));
    customer = await startCustomerHttp({ store, serviceKey, port: port('BRIDGELAYER_SERVICE_PORT', 3031) });
    gateway = await startGateway({
      downstreamUrl: customer.url, serviceKey, jwtSecret, audit, port: port('BRIDGELAYER_GATEWAY_PORT', 3030),
    });
  } catch (error) {
    await gateway?.close(); await customer?.close(); audit?.close(); store.close();
    throw error;
  }
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => shutdownPromise ??= (async () => {
    await gateway.close(); await customer.close(); audit.close(); store.close();
    log({ event: 'http.stopped' });
  })();
  const stop = () => { void shutdown().catch(() => { log({ event: 'http.shutdown_failed' }); process.exitCode = 1; }); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  // Fixed event fields only: secrets and bearer tokens are never printed.
  log({ event: 'http.ready' });
}
main().catch(() => { log({ event: 'http.startup_failed' }); process.exitCode = 1; });
