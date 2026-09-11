import { resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { CustomerStore } from '../customer/store.js';
import { log } from '../logger.js';
import { createCustomerServer } from './server.js';

async function main() {
  const store = new CustomerStore(process.env.SUPPORTBRIDGE_DB ?? resolve('data/supportbridge.sqlite'));
  const server = createCustomerServer(store);
  const transport = new StdioServerTransport();
  // The SDK reports framing errors through onerror. Return its supported error
  // envelope without an ID when the rejected message could not be correlated.
  transport.onerror = error => {
    const code = error instanceof SyntaxError ? ErrorCode.ParseError
      : error.name === 'ZodError' ? ErrorCode.InvalidRequest : undefined;
    if (code !== undefined) void transport.send({
      jsonrpc: '2.0', error: { code, message: code === ErrorCode.ParseError ? 'Parse error' : 'Invalid request' },
    }).catch(() => log({ event: 'transport.write_error' }));
  };
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await server.close();
    store.close();
    log({ event: 'server.stopped' });
  };
  process.stdin.once('end', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  await server.connect(transport);
  log({ event: 'server.ready' });
}

main().catch(() => {
  log({ event: 'server.startup_failed' });
  process.exitCode = 1;
});
