import { setTimeout as delay } from 'node:timers/promises';
import { TokenBudget } from '../resilience/budget.js';
import { StreamFailure, type Metrics } from '../streaming/contracts.js';
import { CopilotError, type CustomerSummary, type DraftEvent, type DraftRequest } from './contracts.js';
import { liveDraft, livePolicy, type GenerationProvider } from './generation.js';

export const simulationReadMs = 1500;

// Deliberately accepts no live provider, key, persistent ledger, or remote endpoint.
export async function* simulatedDraft(customer: CustomerSummary, request: DraftRequest, options: {
  signal: AbortSignal; stats: Metrics;
}): AsyncGenerator<DraftEvent> {
  const scenario = request.scenario;
  if (request.mode !== 'simulation' || !scenario) throw new CopilotError('INVALID_REQUEST', 400);
  const budget = new TokenBudget(':memory:', { tokens: scenario === 'budget-exhausted' ? 1 : livePolicy.tokens });
  let providerCalls = 0; let cancelled = false;
  const provider: GenerationProvider = {
    kind: 'simulated', model: 'local-failure-fixture',
    open({ signal }) {
      providerCalls++;
      // Observe cancellation synchronously, including when guardStream closes a pending iterator.
      const cancel = () => { cancelled = true; };
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
      return { usage: () => undefined, bytes: (async function* () {
        try {
          signal.throwIfAborted();
          if (scenario === 'rate-limit') {
            await delay(500, undefined, { signal });
            throw new StreamFailure('PROVIDER_RATE_LIMIT');
          }
          // The real guardrail read deadline aborts this pending work.
          await delay(60_000, undefined, { signal });
          throw new StreamFailure('INVALID_STREAM');
        } finally { signal.removeEventListener('abort', cancel); }
      })() };
    },
  };
  const observation = (phase: 'started' | 'finished'): DraftEvent => {
    const state = budget.status('copilot-demo');
    return { type: 'simulation', data: { phase, scenario, providerCalls, budgetUsed: state.used,
      budgetAvailable: state.available, cancelled } };
  };
  try {
    options.signal.throwIfAborted();
    yield observation('started');
    try {
      yield* liveDraft(customer, request, { ...options, provider, budget, readMs: simulationReadMs });
    } catch (error) {
      if (!options.signal.aborted) yield observation('finished');
      throw error;
    }
  } finally { budget.close(); }
}
