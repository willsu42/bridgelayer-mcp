import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema, ErrorCode, McpError,
  type CallToolResult, type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { BusinessError, CustomerStore } from '../customer/store.js';
import { customerInput, refundInput } from '../customer/schemas.js';
import { log } from '../logger.js';

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new McpError(ErrorCode.InvalidParams, 'Invalid tool arguments', {
      issues: parsed.error.issues.map(issue => ({ path: issue.path, code: issue.code, message: issue.message })),
    });
  }
  return parsed.data;
}

function result(value: Record<string, unknown>, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError };
}

const tools: Tool[] = [
  {
    name: 'get_customer_record', description: 'Look up a fictional customer. IDs contain five digits, for example CUST-00001.',
    inputSchema: z.toJSONSchema(customerInput, { io: 'input' }) as Tool['inputSchema'],
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'trigger_refund', description: 'Create a simulated USD refund receipt. Amount must represent whole cents. Reason is trimmed before checking its ten-character minimum. Repeated calls create separate receipts.',
    inputSchema: z.toJSONSchema(refundInput, { io: 'input' }) as Tool['inputSchema'],
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
];

export function createCustomerServer(store: CustomerStore): Server {
  // This advanced API keeps assessment-required argument failures as JSON-RPC errors.
  // The SDK still owns initialization, capabilities, request IDs, and serialization.
  const server = new Server({ name: 'supportbridge-customer', version: '0.1.0' }, {
    capabilities: { tools: {} },
    instructions: 'Fictional customer support demo. Refunds are simulated; no payment provider is connected.',
  });

  server.setRequestHandler(z.object({ method: z.literal('tools/list'), params: z.unknown().optional() }), request => {
    parse(z.object({ _meta: z.record(z.string(), z.unknown()).optional() }).strict(), request.params ?? {});
    return { tools };
  });

  // Keep the registration envelope permissive so malformed params reach the SDK's
  // tools/call validator, which maps them to InvalidParams instead of an internal error.
  server.setRequestHandler(z.object({ method: z.literal('tools/call'), params: z.unknown().optional() }), (request, extra) => {
    const { params } = CallToolRequestSchema.parse(request);
    const tool = params.name === 'get_customer_record' || params.name === 'trigger_refund' ? params.name : 'unknown';
    try {
      let value: Record<string, unknown>;
      switch (params.name) {
        case 'get_customer_record': {
          const input = parse(customerInput, params.arguments);
          value = { ...store.getCustomer(input.customer_id) };
          break;
        }
        case 'trigger_refund':
          value = store.refund(parse(refundInput, params.arguments));
          break;
        default:
          throw new McpError(ErrorCode.InvalidParams, 'Unknown tool');
      }
      log({ event: 'tool.call', request_id: extra.requestId, tool, outcome: 'success' });
      return result(value);
    } catch (error) {
      if (error instanceof McpError) {
        log({ event: 'tool.call', request_id: extra.requestId, tool, outcome: 'rejected' });
        throw error;
      }
      if (error instanceof BusinessError) {
        log({ event: 'tool.call', request_id: extra.requestId, tool, outcome: 'business_error' });
        return result({ error: { code: error.code, message: error.message } }, true);
      }
      log({ event: 'tool.call', request_id: extra.requestId, tool, outcome: 'internal_error' });
      throw new McpError(ErrorCode.InternalError, 'Customer service could not complete the request');
    }
  });
  server.onerror = () => log({ event: 'protocol.error' });
  return server;
}
