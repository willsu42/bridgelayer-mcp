import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { fileURLToPath } from 'node:url';
import { header, HttpError, json, listenLoopback, validateEndpoint } from '../http/common.js';
import { issueDemoToken, verifyToken } from '../gateway/auth.js';
import { log, type LogEvent } from '../logger.js';
import { StreamFailure } from '../streaming/contracts.js';
import { writeFrame } from '../streaming/http.js';
import { frame } from '../streaming/provider.js';
import { catalog, CopilotError, draftRequest } from './contracts.js';
import { draftWorkflow, type DraftSource } from './workflow.js';
import type { LiveGeneration } from './generation.js';

const cookieName = 'bridgelayer_demo';
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);

function sessionToken(req: IncomingMessage): string {
  const cookies = (header(req, 'cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${cookieName}=`));
  if (cookies.length !== 1) throw new CopilotError('SESSION_REQUIRED', 401);
  return cookies[0]!.slice(cookieName.length + 1);
}

function readBody(req: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = []; let size = 0;
    const cleanup = () => { clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', fail); req.off('aborted', disconnected); signal.removeEventListener('abort', abort); };
    const fail = (error: unknown) => { cleanup(); req.resume(); reject(error); };
    const abort = () => fail(signal.reason);
    const disconnected = () => fail(new CopilotError('CANCELLED'));
    const data = (chunk: Buffer) => { size += chunk.length; if (size > 8192) fail(new CopilotError('REQUEST_TOO_LARGE', 413)); else parts.push(chunk); };
    const end = () => {
      cleanup();
      try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)))); }
      catch { reject(new CopilotError('INVALID_REQUEST', 400)); }
    };
    const timer = setTimeout(() => fail(new CopilotError('REQUEST_TIMEOUT', 408)), 3000);
    req.on('data', data); req.once('end', end); req.once('error', fail); req.once('aborted', disconnected);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function startCopilot(options: {
  gatewayUrl: string; jwtSecret: string; port?: number; source?: DraftSource; live?: LiveGeneration; logger?: (event: LogEvent) => void;
}) {
  const target = new URL(options.gatewayUrl);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.pathname !== '/mcp' ||
    target.username || target.password || target.search || target.hash) throw new Error('Expected a fixed loopback gateway');
  const loaded = new Map<string, { bytes: Buffer; contentType: string }>();
  for (const [route, [name, contentType]] of assets) {
    const path = name === 'app.js' ? '../../web/app.js' : `../../../web/${name}`;
    loaded.set(route, { bytes: await readFile(fileURLToPath(new URL(path, import.meta.url))), contentType: contentType! });
  }
  const tasks = new Set<Promise<void>>();
  const emit = options.logger ?? log;
  let active = 0;
  const dispatch: Parameters<typeof listenLoopback>[0] = async (req, res) => {
    const id = randomUUID(); const started = performance.now();
    const control = new AbortController(); let admitted = false;
    let outcome: LogEvent['outcome'] = 'rejected';
    const close = () => { if (!res.writableEnded) control.abort(new CopilotError('CANCELLED')); };
    const timer = setTimeout(() => control.abort(new CopilotError('REQUEST_TIMEOUT', 504)), 30_000);
    res.once('close', close);
    res.setHeader('x-request-id', id);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const route = req.url ?? '';
      validateEndpoint(req, route);
      const asset = loaded.get(route);
      if (asset) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new CopilotError('METHOD_NOT_ALLOWED', 405);
        res.writeHead(200, { 'content-type': asset.contentType, 'cache-control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : asset.bytes); outcome = 'success'; return;
      }
      if (!['/api/session', '/api/catalog', '/copilot/draft'].includes(route)) throw new CopilotError('NOT_FOUND', 404);
      if (route === '/api/catalog') {
        if (req.method !== 'GET') throw new CopilotError('METHOD_NOT_ALLOWED', 405);
      } else {
        if (req.method !== 'POST') throw new CopilotError('METHOD_NOT_ALLOWED', 405);
        // Browser-only mutations require an exact same-origin request, even on loopback.
        if (header(req, 'origin') !== `http://${req.headers.host}`) throw new CopilotError('INVALID_ORIGIN', 403);
        if (header(req, 'content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json' ||
          (header(req, 'content-encoding') ?? 'identity') !== 'identity') throw new CopilotError('UNSUPPORTED_MEDIA_TYPE', 415);
      }
      if (route === '/api/session') {
        const body = await readBody(req, control.signal);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0) throw new CopilotError('INVALID_REQUEST', 400);
        // Deliberate local demo bootstrap, not a production login or arbitrary token issuer.
        const token = await issueDemoToken(options.jwtSecret, { sub: 'copilot-demo', tenant_id: 'copilot-demo', role: 'viewer' });
        res.setHeader('set-cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=900`);
        json(res, 200, { mode: 'scripted', expiresIn: 900 }); outcome = 'success'; return;
      }
      let token: string;
      try {
        token = sessionToken(req);
        const identity = await verifyToken(`Bearer ${token}`, options.jwtSecret);
        if (identity.sub !== 'copilot-demo' || identity.tenant_id !== 'copilot-demo' || identity.role !== 'viewer') throw new Error();
      } catch { throw new CopilotError('SESSION_REQUIRED', 401); }
      if (route === '/api/catalog') {
        json(res, 200, { ...catalog, live: { available: !!options.live, provider: 'groq', model: options.live?.provider.model ?? null } });
        outcome = 'success'; return;
      }
      const accepts = (header(req, 'accept') ?? '').split(',').some(part => {
        const [type, ...params] = part.trim().toLowerCase().split(';');
        const q = params.map(p => p.trim()).find(p => p.startsWith('q='));
        return type?.trim() === 'text/event-stream' && (q === undefined || (Number(q.slice(2)) > 0 && Number(q.slice(2)) <= 1));
      });
      if (!accepts) throw new CopilotError('SSE_REQUIRED', 406);
      if (active >= 4) throw new CopilotError('STREAM_CAPACITY', 503);
      active++; admitted = true;
      const parsed = draftRequest.safeParse(await readBody(req, control.signal));
      if (!parsed.success) throw new CopilotError('INVALID_REQUEST', 400);
      if (parsed.data.mode === 'live' && !options.live) throw new CopilotError('LIVE_UNAVAILABLE', 503);
      control.signal.throwIfAborted();
      res.setTimeout(0);
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' });
      for await (const event of draftWorkflow(parsed.data, { gatewayUrl: options.gatewayUrl, token, signal: control.signal,
        ...(options.source ? { source: options.source } : {}),
        ...(options.live ? { live: options.live } : {}),
      })) await writeFrame(res, frame(event.type, event.data), control.signal);
      await writeFrame(res, frame('done', { mode: parsed.data.mode }), control.signal);
      res.end(); outcome = 'success';
    } catch (error) {
      const failure = control.signal.aborted ? control.signal.reason : error;
      const code = failure instanceof CopilotError || failure instanceof StreamFailure ? failure.code : failure instanceof HttpError ? 'INVALID_ENDPOINT' : 'DRAFT_FAILED';
      const status = failure instanceof CopilotError ? failure.status : failure instanceof HttpError ? failure.status : 502;
      outcome = code === 'CANCELLED' ? 'cancelled' : code.includes('TIMEOUT') ? 'timeout' : status < 500 ? 'rejected' : 'internal_error';
      control.abort(new CopilotError('CANCELLED'));
      if (res.destroyed || code === 'CANCELLED') { res.destroy(); return; }
      if (res.headersSent) {
        if (res.writableNeedDrain) res.destroy();
        else res.end(frame('error', { code }));
      } else { res.setHeader('connection', 'close'); req.resume(); json(res, status, { error: { code } }); }
    } finally {
      clearTimeout(timer); res.off('close', close); control.abort(new CopilotError('CANCELLED'));
      if (admitted) active--;
      if (!res.destroyed) res.setTimeout(15_000);
      emit({ event: 'copilot.request', request_id: id, outcome, duration_ms: Math.round(performance.now() - started) });
    }
  };
  const running = await listenLoopback((req, res) => {
    const task = dispatch(req, res); tasks.add(task);
    return task.finally(() => tasks.delete(task));
  }, options.port);
  let closing: Promise<void> | undefined;
  return { ...running, url: new URL('/', running.url).href, close: () => closing ??= (async () => {
    await running.close(); await Promise.allSettled([...tasks]);
  })() };
}
