import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TokenBudget } from '../src/resilience/budget.js';
import { resilientStream } from '../src/resilience/router.js';
import { modelMock } from '../src/resilience/mock.js';
import type { ModelProvider, ResilientRequest } from '../src/resilience/provider.js';
import { frame } from '../src/streaming/provider.js';
import { metrics, limits, StreamFailure, type Schedule } from '../src/streaming/contracts.js';

function clock() {
  const tasks = new Set<{ callback: () => void; ms: number }>();
  const schedule: Schedule = (callback, ms) => { const task = { callback, ms }; tasks.add(task); return () => { tasks.delete(task); }; };
  return { tasks, schedule, fire(ms: number) { for (const task of [...tasks]) if (task.ms === ms) { tasks.delete(task); task.callback(); } } };
}
function context(budget: TokenBudget, primary: ModelProvider = modelMock(), backup: ModelProvider = modelMock()) {
  return { tenant: 'tenant', budget, primary, backup, signal: new AbortController().signal, stats: metrics() };
}
const request: ResilientRequest = { fixture: 'split-email', scenario: 'normal' };
async function text(stream: AsyncIterable<string>) { let value = ''; for await (const piece of stream) value += piece; return value; }

test('successful primary uses actual usage and redacts output; no backup is started', async () => {
  const budget = new TokenBudget(':memory:');
  try {
    const output = await text(resilientStream(request, context(budget, modelMock(), { open() { throw new Error('backup called'); } })));
    assert.equal(output, 'Contact [REDACTED_EMAIL] for help.'); assert.equal(budget.status('tenant').used, 40);
  } finally { budget.close(); }
});

test('primary 429 cancels before a single backup and each attempt has its own accounting', async () => {
  const budget = new TokenBudget(':memory:'); let starts = 0; let primarySignal: AbortSignal | undefined;
  const primary: ModelProvider = { open({ signal }) { primarySignal = signal; return { usage: () => undefined,
    bytes: (async function* () { throw new StreamFailure('PROVIDER_RATE_LIMIT'); })() }; } };
  const backup: ModelProvider = { open(input) { starts++; assert.equal(primarySignal?.aborted, true); return modelMock().open(input); } };
  try {
    assert.match(await text(resilientStream(request, context(budget, primary, backup))), /REDACTED_EMAIL/);
    assert.equal(starts, 1); assert.equal(budget.status('tenant').used, 384 + 50);
  } finally { budget.close(); }
});

test('unknown primary cost can prevent backup admission; no provider runs without a reservation', async () => {
  const budget = new TokenBudget(':memory:', { tokens: 500 }); let backups = 0;
  const primary: ModelProvider = { open() { return { usage: () => undefined, bytes: (async function* () { throw new StreamFailure('PROVIDER_RATE_LIMIT'); })() }; } };
  try {
    await assert.rejects(text(resilientStream(request, context(budget, primary, { open() { backups++; throw new Error(); } }))), { code: 'BUDGET_EXHAUSTED' });
    assert.equal(backups, 0); assert.equal(budget.status('tenant').used, 384);
  } finally { budget.close(); }
});

test('first-text deadline ignores late primary response and late usage; backup is isolated', async () => {
  const budget = new TokenBudget(':memory:'); const time = clock();
  let late!: (value: IteratorResult<Uint8Array>) => void; let usage: { input: number; output: number } | undefined;
  let signal: AbortSignal | undefined; let returned = 0;
  const primary: ModelProvider = { open(input) { signal = input.signal; return { usage: () => usage, bytes: {
    [Symbol.asyncIterator]() { return { next: () => new Promise(resolve => { late = resolve; }), return: async () => { returned++; return { done: true, value: undefined }; } }; },
  } }; } };
  try {
    const stream = resilientStream(request, { ...context(budget, primary), schedule: time.schedule });
    const first = stream.next(); time.fire(3000);
    assert.equal((await first).value, 'Contact'); assert.equal(signal?.aborted, true);
    const rest = await text(stream); assert.equal(rest, ' [REDACTED_EMAIL] for help.');
    usage = { input: 0, output: 0 }; late({ done: false, value: Buffer.from(frame('delta', { text: 'late private data ' })) });
    await Promise.resolve();
    assert.equal(budget.status('tenant').used, 434); assert.equal(returned, 1); assert.equal(time.tasks.size, 0);
  } finally { budget.close(); }
});

test('first usable text wins deadline race; stalls after first text do not fall back', async () => {
  const budget = new TokenBudget(':memory:'); const time = clock(); let backups = 0;
  const primary: ModelProvider = { open({ signal }) { return { usage: () => undefined, bytes: (async function* () {
    yield Buffer.from(frame('delta', { text: 'safe ' }));
    await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  })() }; } };
  try {
    const stream = resilientStream(request, { ...context(budget, primary, { open() { backups++; throw new Error(); } }), schedule: time.schedule });
    assert.equal((await stream.next()).value, 'safe'); assert.equal((await stream.next()).value, ' ');
    const next = stream.next(); const checked = assert.rejects(next, { code: 'STREAM_TIMEOUT' });
    // Let the pipeline request the stalled next chunk, then fire its read timer.
    for (let i = 0; i < 10 && ![...time.tasks].some(t => t.ms === 3000); i++) await Promise.resolve();
    time.fire(3000); await checked;
    assert.equal(backups, 0); assert.equal(budget.status('tenant').used, 384);
  } finally { budget.close(); }
});

test('a 429 before safe output discards unresolved primary text before backup', async () => {
  const budget = new TokenBudget(':memory:');
  const primary: ModelProvider = { open() { return { usage: () => undefined, bytes: (async function* () {
    yield Buffer.from(frame('delta', { text: 'sensitive-prefix' })); throw new StreamFailure('PROVIDER_RATE_LIMIT');
  })() }; } };
  try {
    const output = await text(resilientStream(request, context(budget, primary)));
    assert.equal(output, 'Contact [REDACTED_EMAIL] for help.'); assert.doesNotMatch(output, /sensitive/);
  } finally { budget.close(); }
});

test('no fallback after output or for malformed input, and backup failure has no third attempt', async () => {
  for (const scenario of ['after-output', 'backup-failure', 'normal'] as const) {
    const budget = new TokenBudget(':memory:'); let backups = 0; let output = '';
    const backup: ModelProvider = { open(input) { backups++; return modelMock().open(input); } };
    try {
      await assert.rejects(async () => {
        for await (const piece of resilientStream({ fixture: scenario === 'normal' ? 'malformed' : 'plain', scenario }, context(budget, modelMock(), backup))) output += piece;
      });
      assert.equal(backups, scenario === 'backup-failure' ? 1 : 0);
      if (scenario === 'after-output') assert.ok(output.startsWith('Hello '));
    } finally { budget.close(); }
  }
});

test('cancellation and iterator return settle unknown usage without starting a backup', async () => {
  for (const mode of ['abort', 'return'] as const) {
    const budget = new TokenBudget(':memory:'); const control = new AbortController(); let backups = 0;
    try {
      const stream = resilientStream(request, { ...context(budget, modelMock(), { open() { backups++; throw new Error(); } }), signal: control.signal });
      assert.equal((await stream.next()).value, 'Contact');
      if (mode === 'abort') { control.abort(); await assert.rejects(stream.next(), { code: 'CANCELLED' }); }
      else await stream.return(undefined);
      assert.equal(budget.status('tenant').used, 384); assert.equal(backups, 0);
    } finally { budget.close(); }
  }
});

test('a stall after usable but unresolved text does not qualify for timeout fallback', async () => {
  const budget = new TokenBudget(':memory:'); const time = clock(); let backups = 0; let waiting!: () => void;
  const ready = new Promise<void>(resolve => { waiting = resolve; });
  const primary: ModelProvider = { open({ signal }) { return { usage: () => undefined, bytes: (async function* () {
    yield Buffer.from(frame('delta', { text: 'alex' })); waiting();
    await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  })() }; } };
  try {
    const pending = text(resilientStream(request, { ...context(budget, primary, { open() { backups++; throw new Error(); } }), schedule: time.schedule }));
    const checked = assert.rejects(pending, { code: 'STREAM_TIMEOUT' }); await ready; time.fire(3000); await checked;
    assert.equal(backups, 0); assert.equal(budget.status('tenant').used, 384);
  } finally { budget.close(); }
});

test('one overall deadline cancels the request without fallback and clears all timers', async () => {
  const budget = new TokenBudget(':memory:'); const time = clock(); let backups = 0;
  try {
    const stream = resilientStream({ ...request, scenario: 'primary-timeout' }, {
      ...context(budget, modelMock(), { open() { backups++; throw new Error(); } }), schedule: time.schedule,
    });
    const checked = assert.rejects(stream.next(), { code: 'STREAM_TIMEOUT' });
    time.fire(limits.totalMs); await checked;
    assert.equal(backups, 0); assert.equal(budget.status('tenant').used, 384); assert.equal(time.tasks.size, 0);
  } finally { budget.close(); }
});

test('backup timeout never launches a third attempt', async () => {
  const budget = new TokenBudget(':memory:'); const time = clock(); let backups = 0; let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const backup: ModelProvider = { open(input) { backups++; ready(); return modelMock().open({ ...input, role: 'primary', scenario: 'primary-timeout' }); } };
  try {
    const stream = text(resilientStream({ ...request, scenario: 'primary-429' }, { ...context(budget, modelMock(), backup), schedule: time.schedule }));
    const checked = assert.rejects(stream, { code: 'PROVIDER_TIMEOUT' }); await started; time.fire(3000); await checked;
    assert.equal(backups, 1); assert.equal(budget.status('tenant').used, 384);
  } finally { budget.close(); }
});

test('settlement failure prevents fallback while preserving the active reservation', async () => {
  class FailingBudget extends TokenBudget { override settle(): void { throw new StreamFailure('BUDGET_UNAVAILABLE'); } }
  const budget = new FailingBudget(':memory:'); let backups = 0;
  try {
    await assert.rejects(text(resilientStream({ ...request, scenario: 'primary-429' }, context(budget, modelMock(), {
      open() { backups++; throw new Error(); },
    }))), { code: 'BUDGET_UNAVAILABLE' });
    assert.equal(backups, 0); assert.equal(budget.status('tenant').used, 384);
  } finally { budget.close(); }
});
