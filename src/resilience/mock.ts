import { StreamFailure } from '../streaming/contracts.js';
import { fixtureText } from '../streaming/mock.js';
import { frame } from '../streaming/provider.js';
import type { Usage } from './budget.js';
import type { ModelProvider } from './provider.js';

export function modelMock(): ModelProvider {
  return { open({ fixture, scenario, role, signal }) {
    let finalUsage: Usage | undefined;
    return { usage: () => finalUsage, bytes: (async function* () {
      signal.throwIfAborted();
      if (role === 'primary' && (scenario === 'primary-429' || scenario === 'backup-failure')) {
        finalUsage = { input: 0, output: 0 };
        throw new StreamFailure('PROVIDER_RATE_LIMIT');
      }
      if (role === 'backup' && scenario === 'backup-failure') throw new StreamFailure('INVALID_STREAM');
      if (role === 'primary' && scenario === 'primary-timeout') {
        await new Promise<void>((_, reject) => {
          const stop = () => reject(signal.reason);
          signal.addEventListener('abort', stop, { once: true });
          if (signal.aborted) { signal.removeEventListener('abort', stop); stop(); }
        });
      }
      for (const text of fixtureText[fixture]) {
        signal.throwIfAborted();
        const bytes = Buffer.from(frame('delta', { text }));
        for (let i = 0; i < bytes.length; i += 17) yield bytes.subarray(i, i + 17);
        if (scenario === 'after-output') throw new StreamFailure('PROVIDER_RATE_LIMIT');
      }
      if (fixture === 'truncated') return;
      if (fixture === 'malformed') { yield Buffer.from('event: delta\ndata: {broken\n\n'); return; }
      // Synthetic token counts demonstrate accounting; they are not a real tokenizer estimate.
      if (scenario !== 'unknown-usage') finalUsage = { input: 20, output: role === 'primary' ? 20 : 30 };
      yield Buffer.from(frame('done', {}));
    })() };
  } };
}
