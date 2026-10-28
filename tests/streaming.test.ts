import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { ByteDecoder } from '../src/streaming/decoder.js';
import { EventParser } from '../src/streaming/sse.js';
import { EmailRedactor } from '../src/streaming/redactor.js';
import { frame, type Provider } from '../src/streaming/provider.js';
import { guardStream } from '../src/streaming/pipeline.js';
import { limits, metrics, StreamFailure, type Schedule } from '../src/streaming/contracts.js';
import { writeFrame } from '../src/streaming/http.js';
import { emailCases } from './fixtures/streaming.js';

function source(chunks: Uint8Array[]): Provider {
  return { async *open({ signal }) { for (const chunk of chunks) { signal.throwIfAborted(); yield chunk; } } };
}
function wire(texts: string[]): Buffer {
  return Buffer.from(texts.map(text => frame('delta', { text })).join('') + frame('done', {}));
}
function split(bytes: Uint8Array, size: number = limits.chunkBytes): Uint8Array[] {
  return Array.from({ length: Math.ceil(bytes.length / size) }, (_, i) => bytes.subarray(i * size, (i + 1) * size));
}
async function collect(chunks: Uint8Array[]) {
  const stats = metrics(); const pieces: string[] = [];
  for await (const piece of guardStream(source(chunks), 'plain', { signal: new AbortController().signal, stats })) pieces.push(piece);
  return { text: pieces.join(''), pieces, stats };
}
function fakeClock() {
  const tasks = new Set<{ fn: () => void; ms: number }>();
  const schedule: Schedule = (fn, ms) => { const task = { fn, ms }; tasks.add(task); return () => { tasks.delete(task); }; };
  return { schedule, tasks, fire(ms: number) { for (const task of [...tasks]) if (task.ms === ms) { tasks.delete(task); task.fn(); } } };
}

test('email policy: exact fixtures, every text split, and no premature token prefix', () => {
  for (const { input, output } of emailCases) {
    for (let at = 0; at <= input.length; at++) {
      // Split text at code point boundaries; split surrogate transport boundaries are tested as UTF-8 below.
      if (at && /[\uD800-\uDBFF]/.test(input[at - 1]!)) continue;
      const redactor = new EmailRedactor(metrics());
      const prefix = [...redactor.push(input.slice(0, at))].join('');
      const boundary = input.slice(0, at).search(/\S+$/u);
      if (boundary >= 0) assert.ok(!prefix.endsWith('alex'), 'unresolved prefix leaked');
      assert.equal(prefix + [...redactor.push(input.slice(at))].join('') + redactor.finish(), output);
    }
  }
  const r = new EmailRedactor(metrics());
  assert.deepEqual([...r.push('alex')], []);
  assert.deepEqual([...r.push('@example.com')], []);
  assert.deepEqual([...r.push(' ')], ['[REDACTED_EMAIL]', ' ']);
});

test('UTF-8, SSE, escaped JSON, and email deltas survive every wire split and byte-at-a-time', async () => {
  const bytes = Buffer.from('\uFEFF: comment\r\nevent: delta\r\ndata: {"text":"世界 al"}\r\n\r\n' +
    'event: delta\rdata: {"text":\rdata: "ex\\u0040example\\u002ecom 🙂"}\r\r' + frame('done', {}));
  for (let at = 0; at <= bytes.length; at++) {
    assert.equal((await collect([bytes.subarray(0, at), bytes.subarray(at)])).text, '世界 [REDACTED_EMAIL] 🙂');
  }
  assert.equal((await collect(split(bytes, 1))).text, '世界 [REDACTED_EMAIL] 🙂');
  // Deterministic multi-splits, independent of event boundaries.
  for (let seed = 1; seed <= 20; seed++) {
    let state = seed; let offset = 0; const chunks: Uint8Array[] = [];
    while (offset < bytes.length) { state = (state * 1664525 + 1013904223) >>> 0; const size = state % 23 + 1;
      chunks.push(bytes.subarray(offset, offset + size)); offset += size; }
    assert.equal((await collect(chunks)).text, '世界 [REDACTED_EMAIL] 🙂');
  }
});

test('every fixture produces the expected safe output across provider text-event boundaries', async () => {
  for (const { input, output } of emailCases) {
    for (let at = 0; at <= input.length; at++) {
      if (at && /[\uD800-\uDBFF]/.test(input[at - 1]!)) continue;
      const result = await collect(split(wire([input.slice(0, at), input.slice(at)]), 7));
      assert.equal(result.text, output);
      // Hand-authored expected output is also a prefix oracle at every emission.
      let emitted = '';
      for (const piece of result.pieces) { emitted += piece; assert.ok(output.startsWith(emitted)); }
    }
  }
});

test('ordinary text is preserved and oversized ambiguity is suppressed at exact UTF-8 byte bounds', async () => {
  for (const token of ['x'.repeat(4096), '界'.repeat(1365) + 'x']) {
    const exact = await collect(split(wire([token])));
    assert.equal(exact.text, token); assert.equal(exact.stats.peak_token_bytes, 4096);
    const over = await collect(split(wire([token, 'y', ' more ', token, 'yy', '\n'])));
    assert.equal(over.text, '[REDACTED_OVERSIZE] more [REDACTED_OVERSIZE]\n');
    assert.equal(over.stats.suppressions, 2); assert.ok(over.stats.peak_token_bytes <= 4096);
  }
});

test('malformed/truncated streams never flush unresolved sensitive text', async () => {
  const prefix = frame('delta', { text: 'Safe alex@example.com' });
  const bad = [
    '', 'event: delta\ndata: {broken\n\n', 'event: unknown\ndata: {}\n\n',
    'event: delta\ndata: {"text":"\\ud800"}\n\n', 'event: done\ndata: {"extra":"secret"}\n\n',
    'event: delta\ndata: {"text":"secret"}', 'event: delta\ndata: {"text":"x","extra":1}\n\n',
  ];
  for (const suffix of bad) {
    const emitted: string[] = [];
    await assert.rejects(async () => {
      for await (const text of guardStream(source([Buffer.from(prefix + suffix)]), 'plain', { signal: new AbortController().signal })) emitted.push(text);
    }, { code: 'INVALID_STREAM' });
    assert.equal(emitted.join(''), 'Safe ');
  }
  for (const bytes of [new Uint8Array([0xff]), new Uint8Array([0xe2, 0x82])]) {
    await assert.rejects(collect([bytes]), { code: 'INVALID_STREAM' });
  }
  const decoder = new ByteDecoder();
  assert.equal(decoder.decode(new Uint8Array([0xe2])), '');
  assert.throws(() => decoder.decode(), { code: 'INVALID_STREAM' });
});

test('parser line/event, delta, source chunk, and total-input bounds are enforced', async () => {
  const stats = metrics(); const parser = new EventParser(stats);
  assert.deepEqual([...parser.push(':' + 'x'.repeat(limits.lineBytes - 1))], []);
  assert.throws(() => [...parser.push('x')], { code: 'STREAM_LIMIT' });
  assert.equal(stats.peak_line_bytes, limits.lineBytes);
  const other = new EventParser(metrics());
  [...other.push(':' + 'a'.repeat(32766) + '\n')];
  [...other.push(':' + 'a'.repeat(32767))];
  assert.throws(() => [...other.push('x')], { code: 'STREAM_LIMIT' });
  const exactDelta = await collect(split(wire([' '.repeat(limits.deltaBytes)])));
  assert.equal(exactDelta.text.length, limits.deltaBytes);
  await assert.rejects(collect(split(wire([' '.repeat(limits.deltaBytes + 1)]))), { code: 'STREAM_LIMIT' });
  await assert.rejects(collect([Buffer.alloc(limits.chunkBytes + 1)]), { code: 'STREAM_LIMIT' });
  await assert.rejects(collect(Array.from({ length: 65 }, () => new Uint8Array())), { code: 'STREAM_LIMIT' });
  const comment = Buffer.from(':' + 'x'.repeat(limits.chunkBytes - 3) + '\n\n');
  const atLimit = Array.from({ length: limits.totalBytes / limits.chunkBytes }, () => comment);
  // Exactly 1 MiB is allowed, but still requires a done event: EOF is INVALID_STREAM.
  await assert.rejects(collect(atLimit), { code: 'INVALID_STREAM' });
  await assert.rejects(collect([...atLimit, Buffer.from('x')]), { code: 'STREAM_LIMIT' });
});

test('completion closes the provider and consumer demand controls reads', async () => {
  let reads = 0; let closes = 0; let providerSignal: AbortSignal | undefined;
  const provider: Provider = { async *open({ signal }) {
    providerSignal = signal;
    try { reads++; yield wire(['safe text ']); reads++; throw new Error('must not consume past done'); }
    finally { closes++; }
  } };
  const clock = fakeClock();
  const stream = guardStream(provider, 'plain', { signal: new AbortController().signal, schedule: clock.schedule });
  assert.equal((await stream.next()).value, 'safe');
  assert.equal(reads, 1); assert.ok(![...clock.tasks].some(t => t.ms === limits.readMs));
  const output: string[] = [];
  for await (const piece of stream) output.push(piece);
  assert.equal(output.join(''), ' text ');
  await Promise.resolve();
  assert.equal(reads, 1); assert.equal(closes, 1); assert.equal(providerSignal?.aborted, true); assert.equal(clock.tasks.size, 0);
});

test('read timeout, total deadline, and external cancellation stop cooperative pending reads', async () => {
  for (const mode of ['read', 'total', 'abort'] as const) {
    const clock = fakeClock(); const controller = new AbortController();
    let closed = 0;
    const provider: Provider = { async *open({ signal }) {
      try { await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); }
      finally { closed++; }
    } };
    const iterator = guardStream(provider, 'plain', { signal: controller.signal, schedule: clock.schedule });
    const next = iterator.next();
    const check = assert.rejects(next, { code: mode === 'abort' ? 'CANCELLED' : 'STREAM_TIMEOUT' });
    if (mode === 'abort') controller.abort(); else clock.fire(mode === 'read' ? limits.readMs : limits.totalMs);
    await check; await Promise.resolve();
    assert.equal(closed, 1); assert.equal(clock.tasks.size, 0);
  }
});

test('slow writable waits for drain and abort/close removes listeners', async () => {
  for (const mode of ['drain', 'abort', 'close'] as const) {
    const sink = Object.assign(new EventEmitter(), { destroyed: false, write: () => false });
    const controller = new AbortController();
    const pending = writeFrame(sink as unknown as ServerResponse, 'bounded output', controller.signal);
    assert.equal(sink.listenerCount('drain'), 1);
    if (mode === 'drain') { sink.emit('drain'); await pending; }
    else {
      const checked = assert.rejects(pending, { code: 'CANCELLED' });
      if (mode === 'abort') controller.abort(new StreamFailure('CANCELLED')); else sink.emit('close');
      await checked;
    }
    assert.deepEqual(sink.eventNames(), []);
  }
});

test('email matching bounds cover supported labels and conservatively redact malformed surrounding tokens', async () => {
  const local = 'a'.repeat(64);
  const valid = [
    `${local}@${'b'.repeat(63)}.example.com`, "!#$%&'*+-/=?^_`{|}~@example.com",
    'a@x.io', 'A.B@EXAMPLE.COM', 'x'.repeat(65) + '@example.com',
  ];
  for (const address of valid) assert.equal((await collect(split(wire([address])))).text, '[REDACTED_EMAIL]');
  const plain = 'a.'.repeat(2048);
  assert.equal((await collect(split(wire([plain])))).text, plain);
});

test('a blocked sink stops pipeline pulls until drain, and cancellation releases source', async () => {
  let reads = 0; let closed = 0;
  const provider: Provider = { async *open({ signal }) {
    try {
      reads++; yield Buffer.from(frame('delta', { text: 'one ' }));
      signal.throwIfAborted(); reads++; yield Buffer.from(frame('delta', { text: 'two ' }) + frame('done', {}));
    } finally { closed++; }
  } };
  const control = new AbortController();
  const sink = Object.assign(new EventEmitter(), { destroyed: false, write: () => false });
  const stream = guardStream(provider, 'plain', { signal: control.signal });
  const pump = (async () => {
    for await (const text of stream) await writeFrame(sink as unknown as ServerResponse, text, control.signal);
  })();
  // Await the first write without using a wall-clock sleep.
  for (let i = 0; i < 20 && sink.listenerCount('drain') === 0; i++) await Promise.resolve();
  assert.equal(sink.listenerCount('drain'), 1); assert.equal(reads, 1);
  const rejected = assert.rejects(pump, { code: 'CANCELLED' });
  control.abort(); await rejected; await Promise.resolve();
  assert.equal(reads, 1); assert.equal(closed, 1); assert.deepEqual(sink.eventNames(), []);
});

test('total deadline is active while the consumer pauses; ambiguous data is never flushed', async () => {
  const clock = fakeClock();
  const stream = guardStream(source([wire(['safe alex@example.com'])]), 'plain', {
    signal: new AbortController().signal, schedule: clock.schedule,
  });
  assert.equal((await stream.next()).value, 'safe');
  clock.fire(limits.totalMs);
  await assert.rejects(stream.next(), { code: 'STREAM_TIMEOUT' });
  assert.equal(clock.tasks.size, 0);
  const control = new AbortController();
  const atCompletion = guardStream(source([wire(['safe ', 'alex@example.com'])]), 'plain', { signal: control.signal });
  assert.equal((await atCompletion.next()).value, 'safe');
  assert.equal((await atCompletion.next()).value, ' ');
  control.abort();
  // Even a redacted final token must not be flushed after cancellation between events.
  await assert.rejects(atCompletion.next(), { code: 'CANCELLED' });
});

test('seeded streams agree with an independent whole-input policy for known synthetic addresses', async () => {
  const addresses = ['alex@example.com', 'Sam+tag@example.org', 'a.b@example.co.uk'];
  const choices = ['plain', '世界🙂', '(alex@example.com),', addresses[1]!, addresses[2]!, 'x'.repeat(4100)];
  for (let seed = 1; seed <= 12; seed++) {
    let state = seed;
    const random = () => state = (state * 1664525 + 1013904223) >>> 0;
    const text = Array.from({ length: 12 }, () => choices[random() % choices.length]!).join(' \t');
    // Fixture-level oracle uses known strings, not the production detector or state machine.
    const expected = text.split(/(\s+)/u).map(token => /^\s+$/u.test(token) ? token :
      Buffer.byteLength(token) > 4096 ? '[REDACTED_OVERSIZE]' :
      addresses.some(address => token.includes(address)) ? '[REDACTED_EMAIL]' : token).join('');
    const deltas: string[] = [];
    const chars = [...text];
    for (let i = 0; i < chars.length;) { const length = random() % 45 + 1; deltas.push(chars.slice(i, i + length).join('')); i += length; }
    const output = await collect(split(wire(deltas), 113));
    assert.equal(output.text, expected);
    let prefix = '';
    for (const piece of output.pieces) { prefix += piece; assert.ok(expected.startsWith(prefix)); }
  }
});
