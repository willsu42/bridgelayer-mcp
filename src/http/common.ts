import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { JSONRPCMessageSchema, SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js';

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: number, message: string) { super(message); }
}

export function json(res: ServerResponse, status: number, value?: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(value === undefined ? undefined : JSON.stringify(value));
}

export function rpcError(res: ServerResponse, status: number, code: number, message: string, id?: string | number): void {
  json(res, status, { jsonrpc: '2.0', ...(id === undefined ? {} : { id }), error: { code, message } });
}

// Exact local Host/Origin checks prevent a foreign website from addressing a local endpoint.
export function validateEndpoint(req: IncomingMessage): void {
  const port = req.socket.localPort;
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!hosts.includes(req.headers.host ?? '')) throw new HttpError(403, -32600, 'Invalid host');
  if (req.headers.origin !== undefined && !hosts.map(host => `http://${host}`).includes(req.headers.origin)) {
    throw new HttpError(403, -32600, 'Invalid origin');
  }
  if (req.url !== '/mcp') throw new HttpError(404, -32600, 'Not found');
}

export function header(req: IncomingMessage, name: string): string | undefined {
  const occurrences = req.rawHeaders.filter((_, index) => index % 2 === 0)
    .filter(key => key.toLowerCase() === name).length;
  const value = req.headers[name];
  if (occurrences > 1 || Array.isArray(value)) throw new HttpError(400, -32600, 'Duplicate header');
  return value;
}

export function validatePost(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    throw new HttpError(405, -32600, 'Method not allowed');
  }
  if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, -32600, 'Expected application/json');
  }
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') {
    throw new HttpError(415, -32600, 'Content encoding is not supported');
  }
  const accept = req.headers.accept ?? '';
  if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
    throw new HttpError(406, -32600, 'Accept must include application/json and text/event-stream');
  }
  if (req.headers['mcp-session-id'] !== undefined) throw new HttpError(400, -32600, 'Sessions are not supported');
  const version = header(req, 'mcp-protocol-version');
  if (version !== undefined && !SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
    throw new HttpError(400, -32600, 'Unsupported protocol version');
  }
}

export async function readMessage(req: IncomingMessage) {
  const raw = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      clearTimeout(timer);
      req.off('data', data); req.off('end', end); req.off('error', fail); req.off('aborted', aborted);
    };
    const fail = (error: Error) => { cleanup(); req.resume(); reject(error); };
    const aborted = () => fail(new HttpError(400, -32600, 'Request aborted'));
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > 65_536) { fail(new HttpError(413, -32600, 'Request too large')); return; }
      chunks.push(chunk);
    };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks).toString('utf8')); };
    const timer = setTimeout(() => fail(new HttpError(408, -32600, 'Request body timed out')), 3000);
    req.on('data', data); req.once('end', end); req.once('error', fail); req.once('aborted', aborted);
  });
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new HttpError(400, -32700, 'Parse error'); }
  // One message per POST. Reject batches before any member can cause side effects.
  const parsed = JSONRPCMessageSchema.safeParse(value);
  if (!parsed.success || !('method' in parsed.data)) throw new HttpError(400, -32600, 'Invalid request');
  return parsed.data;
}

export type RunningHttp = { server: Server; url: string; close: () => Promise<void> };

export async function listenLoopback(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>, port = 0,
): Promise<RunningHttp> {
  const server = createServer((req, res) => {
    void handler(req, res).catch(error => {
      if (res.headersSent) { res.destroy(); return; }
      const known = error instanceof HttpError ? error : new HttpError(500, -32603, 'Internal server error');
      res.setHeader('connection', 'close');
      rpcError(res, known.status, known.code, known.message);
    });
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 10_000;
  server.timeout = 15_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing listener address');
  let closing: Promise<void> | undefined;
  return {
    server, url: `http://127.0.0.1:${address.port}/mcp`,
    close: () => closing ??= new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
