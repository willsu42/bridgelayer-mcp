import { limits, type Metrics } from './contracts.js';

// Substring matching is deliberately conservative: redact the entire whitespace token.
const atomChar = /[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]/;
const label = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?';
const domain = new RegExp(`^(?:${label}\\.)+[A-Za-z]{2,63}`);
export function containsEmail(token: string): boolean {
  // A trailing single local-atom character is itself a valid local-part substring.
  // Searching bounded domain prefixes at @ avoids repeated unbounded regex backtracking
  // on long dot-heavy tokens. False positives in malformed larger tokens are intentional.
  for (let at = token.indexOf('@'); at !== -1; at = token.indexOf('@', at + 1)) {
    if (at > 0 && atomChar.test(token[at - 1]!) && domain.test(token.slice(at + 1, at + 253))) return true;
  }
  return false;
}
export class EmailRedactor {
  private token = '';
  private bytes = 0;
  private suppressing = false;
  constructor(private readonly stats: Metrics) {}
  private flush(): string {
    const token = this.token;
    this.token = ''; this.bytes = 0;
    if (containsEmail(token)) { this.stats.redactions++; return '[REDACTED_EMAIL]'; }
    return token;
  }
  *push(text: string): Generator<string> {
    for (const char of text) {
      if (/\s/u.test(char)) {
        if (this.token) yield this.flush();
        this.suppressing = false;
        yield char;
      } else if (!this.suppressing) {
        const size = Buffer.byteLength(char);
        if (this.bytes + size > limits.tokenBytes) {
          this.token = ''; this.bytes = 0; this.suppressing = true;
          this.stats.suppressions++;
          yield '[REDACTED_OVERSIZE]';
        } else {
          this.token += char; this.bytes += size;
          this.stats.peak_token_bytes = Math.max(this.stats.peak_token_bytes, this.bytes);
        }
      }
    }
  }
  finish(): string { return this.flush(); }
}
