export const limits = Object.freeze({
  bodyBytes: 4096, tokenBytes: 4096, lineBytes: 65_536, eventBytes: 65_536,
  chunkBytes: 16_384, deltaBytes: 16_384, totalBytes: 1_048_576,
  emptyChunks: 64, streams: 4, bodyMs: 3000, readMs: 3000, totalMs: 30_000,
});
export type FailureCode = 'INVALID_STREAM' | 'STREAM_LIMIT' | 'STREAM_TIMEOUT' | 'CANCELLED';
export class StreamFailure extends Error {
  constructor(readonly code: FailureCode) { super(code); }
}
export type Metrics = {
  input_bytes: number; output_bytes: number; redactions: number; suppressions: number;
  peak_token_bytes: number; peak_line_bytes: number; peak_event_bytes: number; peak_output_bytes: number; peak_frame_bytes: number;
};
export function metrics(): Metrics {
  return { input_bytes: 0, output_bytes: 0, redactions: 0, suppressions: 0,
    peak_token_bytes: 0, peak_line_bytes: 0, peak_event_bytes: 0, peak_output_bytes: 0, peak_frame_bytes: 0 };
}
// Returning a cancellation function allows deadline tests to use an explicit scheduler.
export type Schedule = (callback: () => void, ms: number) => () => void;
export const schedule: Schedule = (callback, ms) => {
  const timer = setTimeout(callback, ms);
  return () => clearTimeout(timer);
};
export function aborted(signal: AbortSignal): StreamFailure {
  return signal.reason instanceof StreamFailure ? signal.reason : new StreamFailure('CANCELLED');
}
export function interruptible<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(aborted(signal));
  return new Promise((resolve, reject) => {
    const stop = () => { cleanup(); reject(aborted(signal)); };
    const cleanup = () => signal.removeEventListener('abort', stop);
    signal.addEventListener('abort', stop, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
