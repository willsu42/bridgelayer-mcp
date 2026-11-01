import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { TokenBudget } from '../src/resilience/budget.js';

test('atomic reservation, tenant isolation, reconciliation, and exact rolling-window boundary', () => {
  let now = 1000;
  const store = new TokenBudget(':memory:', { tokens: 1000, now: () => now });
  try {
    const first = store.reserve('one', 800, 'primary');
    assert.throws(() => store.reserve('one', 201, 'primary'), { code: 'BUDGET_EXHAUSTED' });
    assert.doesNotThrow(() => store.reserve('two', 1000, 'primary'));
    store.settle(first, { input: 100, output: 100 });
    assert.deepEqual(store.status('one'), { used: 200, available: 800 });
    now = 60_999; assert.equal(store.status('one').used, 200);
    now = 61_000; assert.equal(store.status('one').used, 0);
    assert.equal(store.status('two').used, 1000); // Active reservations never expire with the usage window.
  } finally { store.close(); }
});

test('restart retains reservations; expired leases become unknown charges for a fresh window', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bridgelayer-budget-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'budget.sqlite'); let now = 1000;
  const first = new TokenBudget(path, { tokens: 1000, now: () => now });
  const id = first.reserve('tenant', 800, 'primary'); first.close();
  const reopened = new TokenBudget(path, { tokens: 1000, now: () => now });
  try {
    now = 61_001; assert.equal(reopened.status('tenant').used, 800);
    now = 121_000; assert.equal(reopened.status('tenant').used, 800);
    assert.throws(() => reopened.settle(id, { input: 0, output: 0 }), { code: 'BUDGET_UNAVAILABLE' });
    now = 180_999; assert.equal(reopened.status('tenant').used, 800);
    now = 181_000; assert.equal(reopened.status('tenant').used, 0);
    const db = new DatabaseSync(path);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM token_attempts').get()!.n, 0); db.close();
  } finally { reopened.close(); }
});

test('unknown/invalid usage is conservative; over-reports charge actual usage; repeated settlement cannot refund', () => {
  const store = new TokenBudget(':memory:', { tokens: 1000 });
  try {
    const unknown = store.reserve('unknown', 384, 'primary'); store.settle(unknown);
    assert.equal(store.status('unknown').used, 384);
    assert.throws(() => store.settle(unknown, { input: 0, output: 0 }), { code: 'BUDGET_UNAVAILABLE' });
    const invalid = store.reserve('invalid', 384, 'primary');
    assert.throws(() => store.settle(invalid, { input: NaN, output: 0 }), { code: 'USAGE_INVALID' });
    assert.equal(store.status('invalid').used, 384);
    const over = store.reserve('over', 384, 'primary');
    assert.throws(() => store.settle(over, { input: 500, output: 300 }), { code: 'USAGE_INVALID' });
    assert.equal(store.status('over').used, 800);
    assert.throws(() => store.reserve('over', 384, 'backup'), { code: 'BUDGET_EXHAUSTED' });
  } finally { store.close(); }
});

test('clock rollback cannot restore capacity and database policy mismatches are rejected', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bridgelayer-budget-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'budget.sqlite'); let now = 100_000;
  const store = new TokenBudget(path, { now: () => now });
  try {
    const id = store.reserve('tenant', 500, 'primary'); store.settle(id, { input: 100, output: 100 });
    now = 150_000; store.status('tenant'); now = 0;
    assert.equal(store.status('tenant').used, 200);
    assert.throws(() => new TokenBudget(path, { tokens: 1000 }), /policy differs/);
  } finally { store.close(); }
});

test('SQLite contention fails closed without an implicit retry', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bridgelayer-budget-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'budget.sqlite'); const store = new TokenBudget(path);
  const lock = new DatabaseSync(path);
  try {
    lock.exec('BEGIN IMMEDIATE');
    assert.throws(() => store.reserve('tenant', 384, 'primary'), { code: 'BUDGET_UNAVAILABLE' });
    lock.exec('ROLLBACK'); assert.equal(store.status('tenant').used, 0);
  } finally { lock.close(); store.close(); }
});

test('simultaneous worker connections cannot over-admit a shared tenant budget', { timeout: 10_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bridgelayer-budget-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'budget.sqlite'); const store = new TokenBudget(path, { tokens: 1000 });
  t.after(() => store.close());
  const workers = Array.from({ length: 4 }, () => new Worker(new URL('./fixtures/budget-worker.js', import.meta.url), { workerData: { path } }));
  t.after(() => Promise.all(workers.map(w => w.terminate())).then(() => {}));
  await Promise.all(workers.map(async w => assert.equal((await once(w, 'message'))[0], 'ready')));
  const results = workers.map(w => once(w, 'message'));
  for (const worker of workers) worker.postMessage('start');
  const values = (await Promise.all(results)).map(r => r[0]);
  assert.equal(values.filter(v => v === 'accepted').length, 1);
  assert.ok(values.every(v => v === 'accepted' || v === 'BUDGET_EXHAUSTED' || v === 'BUDGET_UNAVAILABLE'));
  assert.equal(store.status('tenant').used, 600);
});

test('known and unknown terminal charges survive restart and expire exactly once', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bridgelayer-budget-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'budget.sqlite'); let now = 2000;
  const first = new TokenBudget(path, { now: () => now });
  first.settle(first.reserve('tenant', 384, 'primary'), { input: 20, output: 20 });
  first.settle(first.reserve('tenant', 384, 'backup')); first.close();
  const second = new TokenBudget(path, { now: () => now });
  try {
    assert.equal(second.status('tenant').used, 424);
    now = 61_999; assert.equal(second.status('tenant').used, 424);
    now = 62_000; assert.equal(second.status('tenant').used, 0);
  } finally { second.close(); }
});
