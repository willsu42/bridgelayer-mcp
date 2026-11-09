import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GroqProvider } from '../src/copilot/groq.js';
import { buildMessages, inputAllowance, liveDraft, livePolicy } from '../src/copilot/generation.js';
import { draftRequest, type DraftEvent } from '../src/copilot/contracts.js';
import { TokenBudget } from '../src/resilience/budget.js';
import { guardStream } from '../src/streaming/pipeline.js';
import { metrics, StreamFailure } from '../src/streaming/contracts.js';

const customer = { customer_id: 'CUST-00002', name: 'Sam Chen', plan: 'Starter' };
const request = draftRequest.parse({ mode: 'live', customerId: customer.customer_id, caseType: 'billing',
  issue: 'Please explain the charge and contact me at private@example.com.', includeSampleEmail: true });
const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const chunk = (content: string | null, finish: string | null = null, extra = {}) => event({
  choices: [{ index: 0, delta: { content }, finish_reason: finish }], ...extra,
});
const usage = { prompt_tokens: 110, completion_tokens: 40, total_tokens: 150 };
const end = 'data: [DONE]\n\n';
function reply(body: string, size = 17): Response {
  const bytes = Buffer.from(body); let offset = 0;
  return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    if (offset === bytes.length) { controller.close(); return; }
    controller.enqueue(bytes.subarray(offset, offset += Math.min(size, bytes.length - offset)));
  } }), { headers: { 'content-type': 'text/event-stream' } });
}
const success = () => chunk('Hello Sam 👋, email split@') + chunk('example.com for assistance. ') +
  chunk(null, 'stop', { x_groq: { usage } }) + end;
function provider(body = success(), inspect?: (init: RequestInit) => void): GroqProvider {
  return new GroqProvider({ apiKey: 'test-key-not-real', fetch: async (url, init) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions'); inspect?.(init!); return reply(body);
  } });
}
async function collect(source: AsyncIterable<DraftEvent>) { const events: DraftEvent[] = []; for await (const event of source) events.push(event); return events; }
function run(groq: GroqProvider, budget: TokenBudget, signal = new AbortController().signal) {
  return liveDraft(customer, request, { provider: groq, budget, signal, stats: metrics() });
}
const reserved = inputAllowance(buildMessages(customer, request)) + livePolicy.maxOutputTokens;

test('Groq normalizes fragmented UTF-8/SSE, strips reasoning, redacts email, and settles real usage', async t => {
  const budget = new TokenBudget(':memory:'); t.after(() => budget.close());
  let calls = 0;
  const reasoning = event({ choices: [{ index: 0, delta: { reasoning: 'Never expose this private reasoning' }, finish_reason: null }] });
  const events = await collect(run(provider(reasoning + success(), init => {
    calls++; assert.equal(init.redirect, 'error'); assert.ok(init.signal);
    const body = JSON.parse(String(init.body));
    assert.equal(body.model, 'openai/gpt-oss-20b'); assert.equal(body.stream, true);
    assert.equal(body.include_reasoning, false); assert.equal(body.reasoning_effort, 'low');
    assert.equal(body.max_completion_tokens, 1024); assert.equal(body.tools, undefined);
    const input = JSON.parse(body.messages[1].content);
    assert.deepEqual(input.verifiedCustomer, { name: 'Sam Chen', plan: 'Starter' });
    assert.equal(input.customerQuestion, request.issue); assert.equal(input.verifiedCustomer.email, undefined);
  }), budget));
  assert.equal(calls, 1);
  const text = events.filter(e => e.type === 'delta').map(e => e.data.text).join('');
  assert.match(text, /Sam 👋/); assert.match(text, /\[REDACTED_EMAIL\]/);
  assert.doesNotMatch(text, /split@|reasoning|private/);
  const receipt = events.find(e => e.type === 'usage')!;
  assert.equal(receipt.type, 'usage'); if (receipt.type !== 'usage') return;
  assert.deepEqual(receipt.data, { provider: 'groq', model: 'openai/gpt-oss-20b', status: 'known',
    inputTokens: 110, outputTokens: 40, reservedTokens: reserved, chargedTokens: 150, budgetAvailable: 49_850 });
  assert.equal(budget.status('copilot-demo').used, 150);
});

test('Groq supports top-level usage and conservatively retains missing usage', async t => {
  for (const reported of [true, false]) await t.test(reported ? 'reported' : 'missing', async t => {
    const budget = new TokenBudget(':memory:'); t.after(() => budget.close());
    const body = chunk('A useful reply. ', 'stop') + (reported ? event({ choices: [], usage }) : '') + end;
    const events = await collect(run(provider(body), budget));
    const receipt = events.find(e => e.type === 'usage')!;
    assert.equal(receipt.type, 'usage'); if (receipt.type !== 'usage') return;
    assert.equal(receipt.data.status, reported ? 'known' : 'unknown');
    assert.equal(receipt.data.inputTokens, reported ? 110 : null);
    assert.equal(budget.status('copilot-demo').used, reported ? 150 : reserved);
  });
});

test('Groq HTTP errors are sanitized, never retried, and retain unknown reservations', async t => {
  for (const [status, code] of [[429, 'PROVIDER_RATE_LIMIT'], [401, 'PROVIDER_AUTH'], [403, 'PROVIDER_AUTH'],
    [400, 'PROVIDER_REQUEST_REJECTED'], [404, 'PROVIDER_REQUEST_REJECTED'], [500, 'PROVIDER_UNAVAILABLE'], [504, 'PROVIDER_TIMEOUT']] as const) {
    await t.test(String(status), async t => {
      const budget = new TokenBudget(':memory:'); t.after(() => budget.close()); let calls = 0; let cancelled = false;
      const groq = new GroqProvider({ apiKey: 'secret', fetch: async () => { calls++; return new Response(new ReadableStream({
        start(controller) { controller.enqueue(Buffer.from('secret key and customer information')); }, cancel() { cancelled = true; },
      }), { status }); } });
      await assert.rejects(collect(run(groq, budget)), { message: code });
      assert.equal(calls, 1); assert.ok(cancelled); assert.equal(budget.status('copilot-demo').used, reserved);
    });
  }
});

test('budget rejection happens before provider I/O and ledger failures fail closed', async () => {
  const budget = new TokenBudget(':memory:', { tokens: 10 }); let calls = 0;
  await assert.rejects(collect(run(provider(success(), () => calls++), budget)), { message: 'BUDGET_EXHAUSTED' });
  budget.close(); // Closed ledger must not authorize a request either.
  await assert.rejects(collect(run(provider(success(), () => calls++), budget)), { message: 'BUDGET_UNAVAILABLE' });
  assert.equal(calls, 0);
});

test('invalid, truncated and unexpected provider events never flush unresolved email', async t => {
  const pending = chunk('Safe prefix pending@example.com');
  const scenarios: [string, string, string][] = [
    ['EOF', pending, 'INVALID_STREAM'],
    ['missing finish', pending + end, 'INVALID_STREAM'],
    ['malformed', pending + 'data: {bad-json}\n\n', 'INVALID_STREAM'],
    ['error event', pending + 'event: error\ndata: {"secret":"private"}\n\n', 'INVALID_STREAM'],
    ['length', pending + chunk(null, 'length', { usage }) + end, 'PROVIDER_TRUNCATED'],
    ['tool call', pending + chunk(null, 'tool_calls') + end, 'INVALID_STREAM'],
    ['empty', chunk(null, 'stop') + end, 'INVALID_STREAM'],
    ['content after finish', chunk('Hello ', 'stop') + chunk('more') + end, 'INVALID_STREAM'],
    ['bad usage', pending + chunk(null, 'stop', { usage: { ...usage, prompt_tokens: -1 } }) + end, 'USAGE_INVALID'],
    ['nonterminal usage', chunk('Premature ', null, { usage }) + chunk(null, 'stop') + end, 'USAGE_INVALID'],
    ['inconsistent usage', pending + chunk(null, 'stop', { usage: { ...usage, total_tokens: 1 } }) + end, 'USAGE_INVALID'],
    ['lone surrogate', chunk('\ud800') + chunk(null, 'stop') + end, 'INVALID_STREAM'],
  ];
  for (const [name, body, code] of scenarios) await t.test(name, async t => {
    const budget = new TokenBudget(':memory:'); t.after(() => budget.close()); const seen: DraftEvent[] = [];
    await assert.rejects((async () => { for await (const item of run(provider(body), budget)) seen.push(item); })(), { message: code });
    const output = seen.filter(e => e.type === 'delta').map(e => e.data.text).join('');
    assert.doesNotMatch(output, /pending|example.com/);
    assert.equal(budget.status('copilot-demo').used, name === 'length' ? 150 : reserved);
  });
});

test('overreported usage is charged before failing the request', async t => {
  const budget = new TokenBudget(':memory:'); t.after(() => budget.close());
  const over = { prompt_tokens: reserved + 100, completion_tokens: 40, total_tokens: reserved + 140 };
  await assert.rejects(collect(run(provider(chunk('Reply ', 'stop', { usage: over }) + end), budget)), { message: 'USAGE_INVALID' });
  assert.equal(budget.status('copilot-demo').used, over.total_tokens);
});

test('settlement failure prevents a completion receipt', async t => {
  class BrokenSettlement extends TokenBudget { override settle() { throw new StreamFailure('BUDGET_UNAVAILABLE'); } }
  const budget = new BrokenSettlement(':memory:'); t.after(() => budget.close());
  const seen: DraftEvent[] = [];
  await assert.rejects((async () => { for await (const event of run(provider(), budget)) seen.push(event); })(), { message: 'BUDGET_UNAVAILABLE' });
  assert.ok(!seen.some(e => e.type === 'usage')); assert.equal(budget.status('copilot-demo').used, reserved);
});

test('Groq wire limits apply before normalization, and large deltas are safely chunked', async t => {
  const budget = new TokenBudget(':memory:'); t.after(() => budget.close());
  await assert.rejects(collect(run(provider('data: ' + 'x'.repeat(70_000)), budget)), { message: 'STREAM_LIMIT' });
  const body = chunk(('Readable \"text\"\n').repeat(1000), 'stop', { usage }) + end;
  const events = await collect(run(provider(body), budget));
  const text = events.filter(e => e.type === 'delta').map(e => e.data.text).join('');
  assert.equal(text, ('Readable \"text\"\n').repeat(1000));
});

test('disconnect aborts Groq fetch and settles unknown usage without retry', { timeout: 3000 }, async t => {
  const budget = new TokenBudget(':memory:'); t.after(() => budget.close());
  const control = new AbortController(); let calls = 0; let aborted = false; let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const groq = new GroqProvider({ apiKey: 'secret', fetch: async (_url, init) => {
    calls++; ready();
    try { await delay(60_000, undefined, { signal: init!.signal! }); }
    finally { aborted = init!.signal!.aborted; }
    throw new Error('unreachable');
  } });
  const running = collect(run(groq, budget, control.signal));
  await started; control.abort(new StreamFailure('CANCELLED'));
  await assert.rejects(running, { message: 'CANCELLED' });
  await delay(0); assert.ok(aborted); assert.equal(calls, 1); assert.equal(budget.status('copilot-demo').used, reserved);
});

test('read timeout aborts upstream and usage stays unknown', { timeout: 3000 }, async () => {
  let aborted = false;
  const groq = new GroqProvider({ apiKey: 'secret', fetch: async (_url, init) => {
    try { await delay(60_000, undefined, { signal: init!.signal! }); }
    finally { aborted = init!.signal!.aborted; }
    throw new Error('unreachable');
  } });
  let attempt: ReturnType<GroqProvider['open']> | undefined;
  await assert.rejects((async () => {
    for await (const _text of guardStream({ open({ signal }) {
      attempt = groq.open({ messages: buildMessages(customer, request), signal, maxOutputTokens: 1024 }); return attempt.bytes;
    } }, 'plain', { signal: new AbortController().signal, readMs: 20 })) { /* no output */ }
  })(), { message: 'STREAM_TIMEOUT' });
  await delay(0); assert.ok(aborted); assert.equal(attempt!.usage(), undefined);
});

test('consumer cancellation closes provider reader and retains reservation', async t => {
  const budget = new TokenBudget(':memory:'); t.after(() => budget.close()); let cancelled = false;
  const groq = new GroqProvider({ apiKey: 'secret', fetch: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(Buffer.from(chunk('Hello there, ') + chunk('still streaming '))); },
    cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'text/event-stream' } }) });
  const stream = run(groq, budget); assert.equal((await stream.next()).value?.type, 'delta');
  await stream.return(undefined); await delay(0);
  assert.ok(cancelled); assert.equal(budget.status('copilot-demo').used, reserved);
});

test('local live usage survives reopening the ledger', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bridgelayer-live-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'budget.sqlite');
  const first = new TokenBudget(path, { tokens: 8000 });
  try { await collect(run(provider(), first)); } finally { first.close(); }
  const second = new TokenBudget(path, { tokens: 8000 });
  try { assert.equal(second.status('copilot-demo').used, 150); } finally { second.close(); }
});
