import { guardStream } from '../streaming/pipeline.js';
import { aborted, schedule, StreamFailure, type Metrics, type Schedule } from '../streaming/contracts.js';
import { TokenBudget } from './budget.js';
import { allowance, type Attempt, type ModelProvider, type ResilientRequest } from './provider.js';

async function* runAttempts(request: ResilientRequest, options: {
  tenant: string; budget: TokenBudget; primary: ModelProvider; backup: ModelProvider;
  signal: AbortSignal; stats: Metrics; schedule?: Schedule;
}): AsyncGenerator<string> {
  const arm = options.schedule ?? schedule;
  let emitted = false;
  for (const role of ['primary', 'backup'] as const) {
    if (options.signal.aborted) throw aborted(options.signal);
    const id = options.budget.reserve(options.tenant, allowance.input + allowance.output, role);
    const control = new AbortController();
    const cancel = () => control.abort(aborted(options.signal));
    options.signal.addEventListener('abort', cancel, { once: true });
    if (options.signal.aborted) cancel();
    const cancelFirst = arm(() => control.abort(new StreamFailure('PROVIDER_TIMEOUT')), 3000);
    let firstText = false;
    let attempt: Attempt | undefined;
    let failure: unknown;
    let completed = false;
    try {
      const provider = role === 'primary' ? options.primary : options.backup;
      for await (const text of guardStream({ open({ signal }) {
        attempt = provider.open({ ...request, role, signal, maxOutputTokens: allowance.output });
        return attempt.bytes;
      } }, request.fixture, { signal: control.signal, stats: options.stats, schedule: arm,
        onText: () => { firstText = true; cancelFirst(); },
      })) {
        emitted = true; // Commit to this attempt before handing any text to the HTTP writer.
        yield text;
      }
      completed = true;
    } catch (error) { failure = error; }
    finally {
      cancelFirst(); options.signal.removeEventListener('abort', cancel);
      control.abort(new StreamFailure('CANCELLED'));
      let usage;
      try { usage = attempt?.usage(); } catch { /* unknown usage keeps the full reservation */ }
      // Settlement errors fail closed. Do not launch a backup with an uncertain budget ledger.
      options.budget.settle(id, usage);
      if (usage && (usage.input > allowance.input || usage.output > allowance.output)) throw new StreamFailure('USAGE_INVALID');
    }
    if (completed) return;
    if (options.signal.aborted) throw aborted(options.signal);
    const code = failure instanceof StreamFailure ? failure.code : 'INVALID_STREAM';
    const eligible = code === 'PROVIDER_RATE_LIMIT' || code === 'PROVIDER_TIMEOUT' || (code === 'STREAM_TIMEOUT' && !firstText);
    if (role === 'primary' && !emitted && eligible) continue;
    throw failure instanceof StreamFailure ? failure : new StreamFailure('INVALID_STREAM');
  }
}

// A single deadline covers primary + backup, including a paused downstream consumer.
export async function* resilientStream(request: ResilientRequest, options: Parameters<typeof runAttempts>[1]): AsyncGenerator<string> {
  const control = new AbortController();
  const cancel = () => control.abort(aborted(options.signal));
  options.signal.addEventListener('abort', cancel, { once: true });
  if (options.signal.aborted) cancel();
  const cancelDeadline = (options.schedule ?? schedule)(() => control.abort(new StreamFailure('STREAM_TIMEOUT')), 30_000);
  try { yield* runAttempts(request, { ...options, signal: control.signal }); }
  finally { cancelDeadline(); options.signal.removeEventListener('abort', cancel); control.abort(new StreamFailure('CANCELLED')); }
}
