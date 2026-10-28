import { ByteDecoder } from './decoder.js';
import { EventParser } from './sse.js';
import { EmailRedactor } from './redactor.js';
import { parseEvent, type Fixture, type Provider } from './provider.js';
import { aborted, interruptible, limits, metrics, schedule, StreamFailure, type Metrics, type Schedule } from './contracts.js';

export async function* guardStream(provider: Provider, fixture: Fixture, options: {
  signal: AbortSignal; stats?: Metrics; schedule?: Schedule;
}): AsyncGenerator<string> {
  const stats = options.stats ?? metrics();
  const arm = options.schedule ?? schedule;
  const control = new AbortController();
  const stop = () => control.abort(aborted(options.signal));
  options.signal.addEventListener('abort', stop, { once: true });
  if (options.signal.aborted) stop();
  const cancelDeadline = arm(() => control.abort(new StreamFailure('STREAM_TIMEOUT')), limits.totalMs);
  let source: AsyncIterator<Uint8Array> | undefined;
  let emptyChunks = 0;
  const decoder = new ByteDecoder();
  const parser = new EventParser(stats);
  const redactor = new EmailRedactor(stats);
  const record = (text: string) => {
    const bytes = Buffer.byteLength(text);
    stats.output_bytes += bytes;
    stats.peak_output_bytes = Math.max(stats.peak_output_bytes, bytes);
    return text;
  };
  try {
    control.signal.throwIfAborted();
    source = provider.open({ fixture, signal: control.signal })[Symbol.asyncIterator]();
    while (true) {
      control.signal.throwIfAborted();
      const cancelRead = arm(() => control.abort(new StreamFailure('STREAM_TIMEOUT')), limits.readMs);
      let item: IteratorResult<Uint8Array>;
      try { item = await interruptible(Promise.resolve(source.next()), control.signal); }
      finally { cancelRead(); }
      if (item.done) {
        decoder.decode(); // Validate a trailing incomplete UTF-8 code point, then reject missing done.
        throw new StreamFailure('INVALID_STREAM');
      }
      if (item.value.byteLength > limits.chunkBytes || stats.input_bytes + item.value.byteLength > limits.totalBytes) {
        throw new StreamFailure('STREAM_LIMIT');
      }
      emptyChunks = item.value.byteLength === 0 ? emptyChunks + 1 : 0;
      if (emptyChunks > limits.emptyChunks) throw new StreamFailure('STREAM_LIMIT');
      stats.input_bytes += item.value.byteLength;
      for (const event of parser.push(decoder.decode(item.value))) {
        control.signal.throwIfAborted();
        const value = parseEvent(event);
        if (value.type === 'done') {
          const tail = redactor.finish();
          if (tail) yield record(tail);
          control.signal.throwIfAborted();
          return;
        }
        for (const text of redactor.push(value.text)) {
          control.signal.throwIfAborted();
          yield record(text);
        }
      }
    }
  } catch (error) {
    if (control.signal.aborted) throw aborted(control.signal);
    throw error instanceof StreamFailure ? error : new StreamFailure('INVALID_STREAM');
  } finally {
    cancelDeadline(); options.signal.removeEventListener('abort', stop);
    control.abort(new StreamFailure('CANCELLED'));
    // Do not let a broken adapter's pending next()/return() hold the HTTP response open.
    // Cooperative adapters must stop their own I/O upon abort; no background retries are allowed.
    try { void Promise.resolve(source?.return?.()).catch(() => {}); } catch { /* sanitized cleanup */ }
  }
}
