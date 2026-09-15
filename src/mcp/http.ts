import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CustomerStore } from '../customer/store.js';
import { createCustomerServer } from './server.js';
import { header, HttpError, listenLoopback, readMessage, validateEndpoint, validatePost } from '../http/common.js';
import { secretBytes, serviceKeyMatches } from '../gateway/auth.js';

export async function startCustomerHttp(options: { store: CustomerStore; serviceKey: string; port?: number }) {
  secretBytes(options.serviceKey);
  return listenLoopback(async (req, res) => {
    validateEndpoint(req);
    if (!serviceKeyMatches(header(req, 'x-bridgelayer-service-key'), options.serviceKey)) {
      throw new HttpError(401, -32000, 'Service authentication required');
    }
    validatePost(req, res);
    const message = await readMessage(req);
    // Never reuse a stateless transport: clients may use the same JSON-RPC IDs.
    const server = createCustomerServer(options.store, { adminTool: true });
    // Omitting the generator selects stateless mode. The SDK's optional-property
    // declarations do not accept an explicit undefined with our strict settings.
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    const close = () => { void server.close().catch(() => {}); };
    res.once('close', close);
    try {
      // SDK 1.30.0 declares onclose differently on these two compatible SDK types.
      await server.connect(transport as Transport);
      if (res.destroyed) { await server.close(); return; }
      await transport.handleRequest(req, res, message);
    } catch (error) {
      await server.close();
      throw error;
    }
  }, options.port);
}
