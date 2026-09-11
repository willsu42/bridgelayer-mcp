import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { RefundInput } from './schemas.js';

export class BusinessError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export interface Customer {
  customer_id: string;
  name: string;
  email: string;
  plan: string;
}

export class CustomerStore {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 3000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS customers (
        customer_id TEXT PRIMARY KEY, name TEXT NOT NULL,
        email TEXT NOT NULL, plan TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS refunds (
        refund_id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL REFERENCES customers(customer_id),
        amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
        currency TEXT NOT NULL CHECK(currency = 'USD'),
        reason TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL,
        refund_id TEXT NOT NULL REFERENCES refunds(refund_id),
        created_at TEXT NOT NULL
      );
    `);
    const seed = this.db.prepare('INSERT OR IGNORE INTO customers VALUES (?, ?, ?, ?)');
    seed.run('CUST-00001', 'Alex Rivera', 'alex@example.com', 'Pro');
    seed.run('CUST-00002', 'Sam Chen', 'sam@example.com', 'Starter');
    seed.run('CUST-00003', 'Jordan Taylor', 'jordan@example.com', 'Team');
  }

  getCustomer(customerId: string): Customer {
    const row = this.db.prepare('SELECT * FROM customers WHERE customer_id = ?').get(customerId);
    if (!row) throw new BusinessError('CUSTOMER_NOT_FOUND', 'Customer was not found');
    return row as unknown as Customer;
  }

  refund(input: RefundInput) {
    this.getCustomer(input.customer_id);
    // Parse the JSON number's decimal representation without multiplying floats.
    const decimal = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(input.amount));
    const exactCents = decimal ? BigInt(decimal[1]!) * 100n + BigInt((decimal[2] ?? '').padEnd(2, '0')) : 0n;
    if (exactCents < 1n || exactCents > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new BusinessError('UNSUPPORTED_AMOUNT', 'Simulated USD refunds require a safely representable whole-cent amount');
    }
    const cents = Number(exactCents);
    const receipt = {
      refund_id: `REF-${randomUUID()}`,
      customer_id: input.customer_id,
      amount_cents: cents,
      currency: 'USD',
      status: 'simulated',
      created_at: new Date().toISOString(),
    };
    // Both writes commit together. No network calls belong inside this transaction.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO refunds VALUES (?, ?, ?, ?, ?, ?)').run(
        receipt.refund_id, receipt.customer_id, cents, 'USD', input.reason, receipt.created_at,
      );
      this.db.prepare('INSERT INTO audit_events VALUES (?, ?, ?, ?)').run(
        randomUUID(), 'refund.simulated', receipt.refund_id, receipt.created_at,
      );
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return receipt;
  }

  close() { this.db.close(); }
}
