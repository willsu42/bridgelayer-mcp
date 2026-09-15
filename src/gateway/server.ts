import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import { header, HttpError, json, listenLoopback, readMessage, rpcError, validateEndpoint, validatePost } from '../http/common.js';
import { secretBytes, verifyToken } from './auth.js';
import { GatewayAudit } from './audit.js';
import { log, type LogEvent } from '../logger.js';

export async function startGateway(options: {
  downstreamUrl: string; serviceKey: string; jwtSecret: string; audit: GatewayAudit;
  port?: number; timeoutMs?: number; logger?: (event: LogEvent) => void;
}) {
  secretBytes(options.serviceKey); secretBytes(options.jwtSecret);
  if (options.serviceKey === options.jwtSecret) throw new Error('Use separate gateway and downstream credentials');
  const target = new URL(options.downstreamUrl);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.pathname !== '/mcp' ||
      target.username || target.password || target.search || target.hash) {
    throw new Error('Downstream must be a fixed loopback /mcp endpoint');
  }
  const timeoutMs = options.timeoutMs ?? 3000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Error('Invalid downstream timeout');
  const emit = options.logger ?? log;
  return listenLoopback(async (req, res) => {
    const started = performance.now();
    let id: string | number | undefined;
    let outcome: LogEvent['outcome'] = 'rejected';
    const abort = new AbortController();
    const disconnected = () => { if (!res.writableEnded) abort.abort(); };
    res.once('close', disconnected);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      validateEndpoint(req);
      let principal;
      try { principal = await verifyToken(header(req, 'authorization'), options.jwtSecret); }
      catch {
        // Authenticate before reading/parsing an untrusted body. No unverified identity is audited.
        options.audit.deny('INVALID_CREDENTIALS');
        res.setHeader('www-authenticate', 'Bearer realm="bridgelayer"');
        throw new HttpError(401, -32000, 'Authentication required');
      }
      validatePost(req, res);
      const message = await readMessage(req);
      id = 'id' in message ? message.id : undefined;
      if (message.method === 'tools/call' && typeof message.params?.name === 'string' &&
          message.params.name.startsWith('admin_') && principal.role !== 'admin') {
        options.audit.deny('UNAUTHORIZED_TOOL', id);
        // Notifications get no JSON-RPC response and never execute a denied call.
        if (id === undefined) json(res, 202);
        else rpcError(res, 200, -32001, 'Unauthorized Tool Call', id);
        return;
      }
      if (abort.signal.aborted || res.destroyed) return;
      timer = setTimeout(() => { timedOut = true; abort.abort(); }, timeoutMs);
      const version = header(req, 'mcp-protocol-version');
      // Explicit allowlist: never forward Authorization, cookies, user-supplied service keys, or redirects.
      const upstream = await fetch(target, {
        method: 'POST', redirect: 'error', signal: abort.signal,
        headers: {
          'content-type': 'application/json', accept: 'application/json, text/event-stream',
          'x-bridgelayer-service-key': options.serviceKey,
          ...(version === undefined ? {} : { 'mcp-protocol-version': version }),
        },
        body: JSON.stringify(message),
      });
      if (id === undefined) {
        await upstream.body?.cancel();
        if (upstream.status !== 202) throw new Error('Invalid notification acknowledgement');
        outcome = 'success'; json(res, 202); return;
      }
      if (upstream.status !== 200 || !upstream.headers.get('content-type')?.startsWith('application/json')) {
        await upstream.body?.cancel();
        throw new Error('Invalid downstream response');
      }
      const reader = upstream.body?.getReader();
      if (!reader) throw new Error('Missing downstream body');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 1_048_576) throw new Error('Downstream response too large');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const parsed = JSONRPCMessageSchema.safeParse(value);
      if (!parsed.success || 'method' in parsed.data || !('id' in parsed.data) || parsed.data.id !== id) {
        throw new Error('Invalid downstream envelope');
      }
      const reply = parsed.data;
      outcome = 'error' in reply ? 'rejected' : reply.result.isError === true ? 'business_error' : 'success';
      // Preserve the downstream result, including unfiltered tools/list and the original request ID.
      json(res, 200, value);
    } catch (error) {
      if (res.destroyed) { outcome = 'cancelled'; return; }
      if (error instanceof HttpError) rpcError(res, error.status, error.code, error.message, id);
      else {
        outcome = timedOut ? 'timeout' : 'internal_error';
        rpcError(res, timedOut ? 504 : 502, timedOut ? -32003 : -32002,
          timedOut ? 'Downstream timed out; operation outcome may be unknown' : 'Gateway could not complete the request', id);
      }
    } finally {
      if (timer) clearTimeout(timer);
      res.off('close', disconnected);
      emit({
        event: 'gateway.request', ...(id === undefined ? {} : { request_id: id }),
        outcome, duration_ms: Math.round((performance.now() - started) * 100) / 100,
      });
    }
  }, options.port);
}
