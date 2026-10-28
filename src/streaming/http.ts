import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { header, HttpError, json, validateEndpoint } from '../http/common.js';
import { verifyToken } from '../gateway/auth.js';
import type { GatewayAudit } from '../gateway/audit.js';
import type { LogEvent } from '../logger.js';
import { aborted, limits, metrics, schedule, StreamFailure, type Schedule } from './contracts.js';
import { guardStream } from './pipeline.js';
import { frame, requestSchema, type Provider } from './provider.js';
import { mockProvider } from './mock.js';

class RequestFailure extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
function readBody(req: IncomingMessage, signal: AbortSignal, arm: Schedule): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      cancelTimer(); req.off('data', data); req.off('end', end); req.off('error', fail);
      req.off('aborted', abortRequest); signal.removeEventListener('abort', abort);
    };
    const fail = (error: unknown) => { cleanup(); req.resume(); reject(error); };
    const abort = () => fail(aborted(signal));
    const abortRequest = () => fail(new StreamFailure('CANCELLED'));
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limits.bodyBytes) { fail(new RequestFailure(413, 'REQUEST_TOO_LARGE')); return; }
      chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
      catch { reject(new RequestFailure(400, 'INVALID_REQUEST')); }
    };
    const cancelTimer = arm(() => fail(new RequestFailure(408, 'REQUEST_TIMEOUT')), limits.bodyMs);
    req.on('data', data); req.once('end', end); req.once('error', fail); req.once('aborted', abortRequest);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

// One bounded frame per write. Never continue pulling the source while the socket is full.
export async function writeFrame(res: ServerResponse, value: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw aborted(signal);
  if (res.destroyed) throw new StreamFailure('CANCELLED');
  if (res.write(value)) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      res.off('drain', drained); res.off('close', closed); res.off('error', closed);
      signal.removeEventListener('abort', cancelled);
    };
    const drained = () => { cleanup(); resolve(); };
    const closed = () => { cleanup(); reject(new StreamFailure('CANCELLED')); };
    const cancelled = () => { cleanup(); reject(aborted(signal)); };
    res.once('drain', drained); res.once('close', closed); res.once('error', closed);
    signal.addEventListener('abort', cancelled, { once: true });
    if (signal.aborted) cancelled();
    else if (res.destroyed) closed();
  });
}

export function createStreamHandler(options: {
  jwtSecret: string; audit: GatewayAudit; emit: (event: LogEvent) => void;
  provider?: Provider; schedule?: Schedule;
}) {
  const provider = options.provider ?? mockProvider();
  const arm = options.schedule ?? schedule;
  let active = 0;
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const requestId = randomUUID();
    const started = performance.now();
    const stats = metrics();
    const control = new AbortController();
    let admitted = false;
    let outcome: LogEvent['outcome'] = 'rejected';
    const close = () => { if (!res.writableEnded) control.abort(new StreamFailure('CANCELLED')); };
    res.once('close', close);
    res.setHeader('x-request-id', requestId);
    const cancelDeadline = arm(() => control.abort(new StreamFailure('STREAM_TIMEOUT')), limits.totalMs);
    try {
      validateEndpoint(req, '/guardrails/stream');
      try { await verifyToken(header(req, 'authorization'), options.jwtSecret); }
      catch {
        options.audit.deny('INVALID_CREDENTIALS');
        res.setHeader('www-authenticate', 'Bearer realm="bridgelayer"');
        throw new RequestFailure(401, 'AUTHENTICATION_REQUIRED');
      }
      if (req.method !== 'POST') { res.setHeader('allow', 'POST'); throw new RequestFailure(405, 'METHOD_NOT_ALLOWED'); }
      if (header(req, 'content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json' ||
          (header(req, 'content-encoding') ?? 'identity') !== 'identity') throw new RequestFailure(415, 'UNSUPPORTED_MEDIA_TYPE');
      // Parse media ranges rather than accepting a substring or a q=0 rejection.
      const accepts = (header(req, 'accept') ?? '').split(',').some(part => {
        const [type, ...parameters] = part.trim().toLowerCase().split(';');
        if (type?.trim() !== 'text/event-stream') return false;
        const q = parameters.map(p => p.trim()).find(p => p.startsWith('q='));
        return q === undefined || (Number(q.slice(2)) > 0 && Number(q.slice(2)) <= 1);
      });
      if (!accepts) throw new RequestFailure(406, 'UNACCEPTABLE_RESPONSE');
      if (active >= limits.streams) throw new RequestFailure(503, 'STREAM_CAPACITY');
      active++; admitted = true;
      res.setTimeout(0); // This route uses an explicit total deadline, including backpressure.
      const parsed = requestSchema.safeParse(await readBody(req, control.signal, arm));
      if (!parsed.success) throw new RequestFailure(400, 'INVALID_REQUEST');
      control.signal.throwIfAborted();
      const openHeaders = () => {
        if (!res.headersSent) res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' });
      };
      for await (const text of guardStream(provider, parsed.data.fixture, { signal: control.signal, stats, schedule: arm })) {
        openHeaders();
        const output = frame('delta', { text });
        stats.peak_frame_bytes = Math.max(stats.peak_frame_bytes, Buffer.byteLength(output));
        await writeFrame(res, output, control.signal);
      }
      openHeaders();
      await writeFrame(res, frame('done', {}), control.signal);
      res.end(); outcome = 'success';
    } catch (error) {
      const failure = control.signal.aborted ? aborted(control.signal) : error;
      const code = failure instanceof StreamFailure || failure instanceof RequestFailure ? failure.code : 'STREAM_FAILED';
      const status = failure instanceof RequestFailure ? failure.status : failure instanceof HttpError ? failure.status :
        code === 'STREAM_TIMEOUT' ? 504 : 502;
      outcome = code === 'CANCELLED' ? 'cancelled' : code === 'STREAM_TIMEOUT' ? 'timeout' : status < 500 ? 'rejected' : 'internal_error';
      control.abort(new StreamFailure('CANCELLED'));
      if (res.destroyed || code === 'CANCELLED') { if (!res.destroyed) res.destroy(); return; }
      if (res.headersSent) {
        // A blocked socket cannot accept another queued error frame. Closing is the error signal.
        if (res.writableNeedDrain) res.destroy();
        else res.end(frame('error', { code }));
      } else {
        res.setHeader('connection', 'close'); req.resume();
        json(res, status, { error: { code } });
      }
    } finally {
      cancelDeadline(); res.off('close', close); control.abort(new StreamFailure('CANCELLED'));
      if (!res.destroyed) res.setTimeout(15_000); // Restore the shared listener's idle timeout.
      if (admitted) active--;
      options.emit({ event: 'stream.request', request_id: requestId, outcome,
        duration_ms: Math.round((performance.now() - started) * 100) / 100, ...stats });
    }
  };
}
