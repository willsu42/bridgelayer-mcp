import { createGuardedHandler } from '../streaming/http.js';
import type { GatewayAudit } from '../gateway/audit.js';
import type { LogEvent } from '../logger.js';
import type { Schedule } from '../streaming/contracts.js';
import { TokenBudget } from './budget.js';
import { resilientRequest, type ModelProvider } from './provider.js';
import { modelMock } from './mock.js';
import { resilientStream } from './router.js';

export function createResilientHandler(options: {
  jwtSecret: string; audit: GatewayAudit; emit: (event: LogEvent) => void;
  budget: TokenBudget; primary?: ModelProvider; backup?: ModelProvider; schedule?: Schedule;
}) {
  const primary = options.primary ?? modelMock();
  const backup = options.backup ?? modelMock();
  return createGuardedHandler({ ...options, path: '/resilient/stream',
    parse(value) { const parsed = resilientRequest.safeParse(value); return parsed.success ? parsed.data : undefined; },
    stream(request, context) {
      return resilientStream(request, { tenant: context.identity.tenant_id, budget: options.budget,
        primary, backup, signal: context.signal, stats: context.stats, schedule: context.schedule });
    },
  });
}
