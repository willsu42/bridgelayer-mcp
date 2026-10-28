import { cpus, platform, arch } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { ByteDecoder } from '../src/streaming/decoder.js';
import { EventParser } from '../src/streaming/sse.js';
import { metrics, type Metrics } from '../src/streaming/contracts.js';
import { mockProvider } from '../src/streaming/mock.js';
import { guardStream } from '../src/streaming/pipeline.js';
import { parseEvent, type Fixture, type Provider } from '../src/streaming/provider.js';

// Benchmark-only reference: never import this unredacted path into the gateway.
async function* reference(provider: Provider, fixture: Fixture, signal: AbortSignal, stats: Metrics) {
  const decoder = new ByteDecoder(); const parser = new EventParser(stats);
  for await (const bytes of provider.open({ fixture, signal })) {
    stats.input_bytes += bytes.byteLength;
    for (const event of parser.push(decoder.decode(bytes))) {
      const value = parseEvent(event);
      if (value.type === 'done') return;
      stats.output_bytes += Buffer.byteLength(value.text);
      stats.peak_output_bytes = Math.max(stats.peak_output_bytes, Buffer.byteLength(value.text));
      yield value.text;
    }
  }
  decoder.decode(); throw new Error('Truncated stream');
}
const count = 10;
const settings = { chunkBytes: 256, delayMs: 1 };
const scenarios: { name: string; fixture: Fixture; consumerMs: number }[] = [
  { name: 'plain', fixture: 'plain', consumerMs: 0 },
  { name: 'split-email', fixture: 'split-email', consumerMs: 0 },
  { name: 'email-heavy', fixture: 'email-heavy', consumerMs: 0 },
  { name: 'long-token', fixture: 'long-token', consumerMs: 0 },
  { name: 'malformed', fixture: 'malformed', consumerMs: 0 },
  { name: 'slow-consumer', fixture: 'plain', consumerMs: 2 },
];
type Sample = { first_ms: number | null; total_ms: number; outcome: string; stats: Metrics; safe_release_ms: number | null };
async function run(fixture: Fixture, consumerMs: number, guarded: boolean): Promise<Sample> {
  const controller = new AbortController(); const stats = metrics(); const started = performance.now();
  let first: number | null = null; let safeRelease: number | null = null; let accumulated = ''; let outcome = 'success';
  // A shared known-safe prefix anchors release-delay comparison on identical synthetic text.
  const anchor = fixture === 'plain' ? 'Hello ' : fixture === 'split-email' ? 'Contact ' : null;
  try {
    const provider = mockProvider(settings);
    const stream = guarded ? guardStream(provider, fixture, { signal: controller.signal, stats }) : reference(provider, fixture, controller.signal, stats);
    for await (const text of stream) {
      if (text && first === null) first = performance.now() - started;
      if (anchor && safeRelease === null) {
        accumulated += text;
        if (accumulated.startsWith(anchor)) { safeRelease = performance.now() - started; accumulated = ''; }
      }
      if (consumerMs) await delay(consumerMs);
    }
  } catch { outcome = 'error'; }
  finally { controller.abort(); }
  return { first_ms: first, total_ms: performance.now() - started, outcome, stats, safe_release_ms: safeRelease };
}
const round = (n: number) => Math.round(n * 1000) / 1000;
function summarize(values: (number | null)[]) {
  const sorted = values.filter((n): n is number => n !== null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return { median: round(sorted[Math.floor(sorted.length / 2)]!), p95: round(sorted[Math.ceil(sorted.length * .95) - 1]!) };
}
const results = [];
for (const scenario of scenarios) {
  const baseline: Sample[] = []; const guarded: Sample[] = [];
  for (let i = 0; i < count; i++) {
    baseline.push(await run(scenario.fixture, scenario.consumerMs, false));
    guarded.push(await run(scenario.fixture, scenario.consumerMs, true));
  }
  results.push({ ...scenario, samples: count,
    reference_first_ms: summarize(baseline.map(s => s.first_ms)), safe_first_ms: summarize(guarded.map(s => s.first_ms)),
    reference_total_ms: summarize(baseline.map(s => s.total_ms)), guarded_total_ms: summarize(guarded.map(s => s.total_ms)),
    aligned_safe_release_added_ms: summarize(guarded.map((s, i) => s.safe_release_ms !== null && baseline[i]!.safe_release_ms !== null ? s.safe_release_ms - baseline[i]!.safe_release_ms! : null)),
    outcomes: guarded.map(s => s.outcome),
    max_metrics: Object.fromEntries(Object.keys(guarded[0]!.stats).map(key => [key, Math.max(...guarded.map(s => s.stats[key as keyof Metrics]))])),
  });
}
console.log(JSON.stringify({ node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model,
  settings, admission: 'pipeline invocation; excludes HTTP and authentication',
  notes: 'Sequential paired runs; timers include scheduler jitter. Slow consumer delay is per emitted fragment, so totals include differing fragment counts. No production throughput claim. Null means no aligned safe span.', results }, null, 2));
