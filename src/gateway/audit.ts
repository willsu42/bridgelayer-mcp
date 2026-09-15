import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// A separate database avoids changing Task 1's refund/audit schema.
// Only authorization denials are durable here; no bearer tokens or tool arguments.
export class GatewayAudit {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 1000;
      CREATE TABLE IF NOT EXISTS gateway_denials (
        event_id TEXT PRIMARY KEY, created_at TEXT NOT NULL,
        request_id TEXT, code TEXT NOT NULL CHECK(code IN ('INVALID_CREDENTIALS', 'UNAUTHORIZED_TOOL'))
      );
    `);
  }
  deny(code: 'INVALID_CREDENTIALS' | 'UNAUTHORIZED_TOOL', requestId?: string | number): void {
    this.db.prepare('INSERT INTO gateway_denials VALUES (?, ?, ?, ?)').run(
      randomUUID(), new Date().toISOString(), requestId === undefined ? null : JSON.stringify(requestId), code,
    );
  }
  close(): void { this.db.close(); }
}
