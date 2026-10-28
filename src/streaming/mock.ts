import { setTimeout as delay } from 'node:timers/promises';
import { frame, type Fixture, type Provider } from './provider.js';

export const fixtureText: Record<Fixture, string[]> = {
  plain: ['Hello ', '世界. ', 'No sensitive data.'],
  'split-email': ['Contact al', 'ex+support', '@example.', 'co.uk for help.'],
  'email-heavy': ['alex@example.com sam@example.org ', 'next@example.net'],
  'long-token': ['x'.repeat(4096), 'x'.repeat(1024), ' safe again.'],
  malformed: ['Safe text. ', 'alex@example.com'],
  truncated: ['Safe text. ', 'alex@example.com'],
};
export function mockProvider(options: { chunkBytes?: number; delayMs?: number } = {}): Provider {
  const chunkBytes = options.chunkBytes ?? 17;
  const delayMs = options.delayMs ?? 0;
  if (!Number.isInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > 16_384 || !Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error('Invalid mock settings');
  }
  return { async *open({ fixture, signal }) {
    for (const text of fixtureText[fixture]) {
      const bytes = Buffer.from(frame('delta', { text }));
      for (let i = 0; i < bytes.length; i += chunkBytes) {
        signal.throwIfAborted();
        if (delayMs) await delay(delayMs, undefined, { signal });
        yield bytes.subarray(i, i + chunkBytes);
      }
    }
    signal.throwIfAborted();
    if (fixture === 'truncated') return;
    yield Buffer.from(fixture === 'malformed' ? 'event: delta\ndata: {broken\n\n' : frame('done', {}));
  } };
}
