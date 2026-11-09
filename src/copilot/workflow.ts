import { guardStream } from '../streaming/pipeline.js';
import { metrics } from '../streaming/contracts.js';
import type { Provider } from '../streaming/provider.js';
import { lookupCustomer } from './customer-client.js';
import { scriptedDraft } from './scripted.js';
import { CopilotError, type CustomerSummary, type DraftEvent, type DraftRequest } from './contracts.js';
import { liveDraft, type LiveGeneration } from './generation.js';

export type DraftSource = (customer: CustomerSummary, request: DraftRequest) => Provider;

export async function* draftWorkflow(request: DraftRequest, context: {
  gatewayUrl: string; token: string; signal: AbortSignal; source?: DraftSource; live?: LiveGeneration;
}): AsyncGenerator<DraftEvent> {
  if (request.mode === 'live' && !context.live) throw new CopilotError('LIVE_UNAVAILABLE', 503);
  yield { type: 'status', data: { step: 'lookup' } };
  const customer = await lookupCustomer({ ...context, customerId: request.customerId });
  context.signal.throwIfAborted();
  yield { type: 'customer', data: customer };
  yield { type: 'status', data: { step: 'generating' } };
  const stats = metrics();
  if (request.mode === 'live') {
    yield* liveDraft(customer, request, { ...context.live!, signal: context.signal, stats });
  } else {
    const source = (context.source ?? scriptedDraft)(customer, request);
    for await (const text of guardStream(source, 'plain', { signal: context.signal, stats })) {
      yield { type: 'delta', data: { text } };
    }
  }
  context.signal.throwIfAborted();
  yield { type: 'metrics', data: { redactions: stats.redactions, suppressions: stats.suppressions, outputBytes: stats.output_bytes } };
}
