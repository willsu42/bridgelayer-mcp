import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CopilotError, customerRecord, type CustomerSummary } from './contracts.js';

export async function lookupCustomer(options: {
  gatewayUrl: string; token: string; customerId: string; signal: AbortSignal;
}): Promise<CustomerSummary> {
  const client = new Client({ name: 'bridgelayer-copilot', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(options.gatewayUrl), {
    requestInit: { headers: { authorization: `Bearer ${options.token}` } },
    fetch: (url, init) => fetch(url, { ...init, redirect: 'error', signal: AbortSignal.any([
      options.signal, ...(init?.signal ? [init.signal] : []),
    ]) }),
  });
  try {
    await client.connect(transport as Transport, { signal: options.signal, timeout: 5000 });
    const reply = await client.callTool({ name: 'get_customer_record', arguments: { customer_id: options.customerId } },
      undefined, { signal: options.signal, timeout: 5000 });
    if (reply.isError) throw new CopilotError('CUSTOMER_NOT_FOUND', 404);
    const customer = customerRecord.safeParse(reply.structuredContent);
    if (!customer.success || customer.data.customer_id !== options.customerId) throw new CopilotError('CUSTOMER_LOOKUP_FAILED');
    // Email is deliberately excluded from both generation input and browser activity events.
    return { customer_id: customer.data.customer_id, name: customer.data.name, plan: customer.data.plan };
  } catch (error) {
    if (options.signal.aborted) throw options.signal.reason;
    throw error instanceof CopilotError ? error : new CopilotError('CUSTOMER_LOOKUP_FAILED');
  } finally { await client.close(); }
}
