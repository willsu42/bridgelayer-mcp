import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { StreamFailure } from '../streaming/contracts.js';

export type Usage = { input: number; output: number };
export const budgetPolicy = Object.freeze({ tokens: 50_000, windowMs: 60_000, leaseMs: 120_000 });
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;

// One local SQLite file supports atomic admissions across connections/processes.
// No network call or asynchronous work is performed inside a transaction.
export class TokenBudget {
  private readonly db: DatabaseSync;
  private readonly clock: () => number;
  private readonly policy: typeof budgetPolicy | { tokens: number; windowMs: number; leaseMs: number };
  constructor(path: string, options: { now?: () => number; tokens?: number; windowMs?: number; leaseMs?: number } = {}) {
    this.policy = { tokens: options.tokens ?? budgetPolicy.tokens, windowMs: options.windowMs ?? budgetPolicy.windowMs,
      leaseMs: options.leaseMs ?? budgetPolicy.leaseMs };
    if (Object.values(this.policy).some(n => !integer(n) || n === 0) || this.policy.leaseMs <= 30_000) throw new Error('Invalid budget policy');
    this.clock = options.now ?? Date.now;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    try {
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 100;
        CREATE TABLE IF NOT EXISTS budget_policy (
          id INTEGER PRIMARY KEY CHECK(id = 1), tokens INTEGER NOT NULL,
          window_ms INTEGER NOT NULL, lease_ms INTEGER NOT NULL, last_now INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS token_attempts (
          id TEXT PRIMARY KEY, tenant TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('primary','backup')),
          reserved INTEGER NOT NULL CHECK(reserved > 0), admitted_at INTEGER NOT NULL, lease_until INTEGER NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('active','known','unknown')),
          charged INTEGER NOT NULL CHECK(charged >= 0), settled_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS token_attempts_tenant ON token_attempts(tenant, state, settled_at);
      `);
      this.db.prepare('INSERT OR IGNORE INTO budget_policy VALUES (1, ?, ?, ?, 0)').run(this.policy.tokens, this.policy.windowMs, this.policy.leaseMs);
      const row = this.db.prepare('SELECT * FROM budget_policy WHERE id = 1').get()!;
      if (row.tokens !== this.policy.tokens || row.window_ms !== this.policy.windowMs || row.lease_ms !== this.policy.leaseMs) {
        throw new Error('Existing budget policy differs');
      }
    } catch (error) { this.db.close(); throw error; }
  }
  private transaction<T>(work: (now: number) => T): T {
    let begun = false;
    try {
      this.db.exec('BEGIN IMMEDIATE'); begun = true;
      const wall = this.clock();
      if (!integer(wall) || !integer(wall + this.policy.leaseMs)) throw new Error('Invalid clock');
      const previous = this.db.prepare('SELECT last_now FROM budget_policy WHERE id = 1').get()!.last_now as number;
      const now = Math.max(wall, previous); // Wall-clock rollback must not restore budget capacity.
      this.db.prepare('UPDATE budget_policy SET last_now = ? WHERE id = 1').run(now);
      // A crashed owner's reservation is charged conservatively at recovery time, not forgotten.
      this.db.prepare("UPDATE token_attempts SET state = 'unknown', charged = reserved, settled_at = ? WHERE state = 'active' AND lease_until <= ?").run(now, now);
      this.db.prepare("DELETE FROM token_attempts WHERE state != 'active' AND settled_at <= ?").run(now - this.policy.windowMs);
      const result = work(now);
      this.db.exec('COMMIT'); begun = false;
      return result;
    } catch (error) {
      if (begun) { try { this.db.exec('ROLLBACK'); } catch { /* preserve sanitized failure */ } }
      throw error instanceof StreamFailure ? error : new StreamFailure('BUDGET_UNAVAILABLE');
    }
  }
  private used(tenant: string): number {
    return this.db.prepare('SELECT COALESCE(SUM(charged), 0) AS used FROM token_attempts WHERE tenant = ?').get(tenant)!.used as number;
  }
  reserve(tenant: string, amount: number, role: 'primary' | 'backup'): string {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(tenant) || !integer(amount) || amount === 0) throw new StreamFailure('BUDGET_UNAVAILABLE');
    const id = this.transaction(now => {
      if (amount > this.policy.tokens - this.used(tenant)) return undefined;
      const id = randomUUID();
      this.db.prepare("INSERT INTO token_attempts VALUES (?, ?, ?, ?, ?, ?, 'active', ?, NULL)")
        .run(id, tenant, role, amount, now, now + this.policy.leaseMs, amount);
      return id;
    });
    if (!id) throw new StreamFailure('BUDGET_EXHAUSTED');
    return id;
  }
  settle(id: string, usage?: Usage): void {
    const invalid = usage !== undefined && (typeof usage !== 'object' || usage === null || !integer(usage.input) || !integer(usage.output) || !integer(usage.input + usage.output));
    const result = this.transaction(now => {
      const row = this.db.prepare('SELECT reserved, state FROM token_attempts WHERE id = ?').get(id);
      if (!row || row.state !== 'active') return 'stale'; // Never accept a late report twice or after recovery.
      const reserved = row.reserved as number;
      const known = usage !== undefined && !invalid;
      const charged = known ? usage.input + usage.output : reserved;
      this.db.prepare('UPDATE token_attempts SET state = ?, charged = ?, settled_at = ? WHERE id = ?')
        .run(known ? 'known' : 'unknown', charged, now, id);
      return invalid || charged > reserved ? 'invalid' : 'ok';
    });
    if (result === 'stale') throw new StreamFailure('BUDGET_UNAVAILABLE');
    if (result === 'invalid') throw new StreamFailure('USAGE_INVALID');
  }
  status(tenant: string): { used: number; available: number } {
    return this.transaction(() => { const used = this.used(tenant); return { used, available: Math.max(0, this.policy.tokens - used) }; });
  }
  close(): void { this.db.close(); }
}
