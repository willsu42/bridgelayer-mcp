import { z } from 'zod';
import { limits, StreamFailure } from './contracts.js';
import type { Event } from './sse.js';

export const fixtures = ['plain', 'split-email', 'email-heavy', 'long-token', 'malformed', 'truncated'] as const;
export type Fixture = typeof fixtures[number];
export const requestSchema = z.strictObject({ fixture: z.enum(fixtures) });
// Sources must observe signal cancellation and bound every byte chunk to 16 KiB.
export interface Provider {
  open(input: { fixture: Fixture; signal: AbortSignal }): AsyncIterable<Uint8Array>;
}
const delta = z.strictObject({ text: z.string() });
const done = z.strictObject({});
export function parseEvent(event: Event): { type: 'delta'; text: string } | { type: 'done' } {
  try {
    const value: unknown = JSON.parse(event.data);
    if (event.event === 'done') { done.parse(value); return { type: 'done' }; }
    if (event.event !== 'delta') throw new Error();
    const { text } = delta.parse(value);
    // JSON may contain escaped lone surrogates even when its wire UTF-8 is valid.
    if (/[\uD800-\uDFFF]/u.test(text)) throw new Error();
    if (Buffer.byteLength(text) > limits.deltaBytes) throw new StreamFailure('STREAM_LIMIT');
    return { type: 'delta', text };
  } catch (error) {
    if (error instanceof StreamFailure) throw error;
    throw new StreamFailure('INVALID_STREAM');
  }
}
export function frame(event: string, value: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
}
