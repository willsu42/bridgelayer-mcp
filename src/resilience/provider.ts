import { z } from 'zod';
import { fixtures, type Fixture } from '../streaming/provider.js';
import type { Usage } from './budget.js';

export const scenarios = ['normal', 'primary-429', 'primary-timeout', 'backup-failure', 'after-output', 'unknown-usage'] as const;
export type Scenario = typeof scenarios[number];
export const resilientRequest = z.strictObject({ fixture: z.enum(fixtures), scenario: z.enum(scenarios).default('normal') });
export type ResilientRequest = z.infer<typeof resilientRequest>;
export const allowance = Object.freeze({ input: 128, output: 256 });
export interface Attempt {
  bytes: AsyncIterable<Uint8Array>;
  // Trusted adapter accounting, not client supplied or inferred from the redacted output.
  // Only finalized usage may be returned; undefined means unknown, including after cancellation.
  usage(): Usage | undefined;
}
export interface ModelProvider {
  open(input: { fixture: Fixture; scenario: Scenario; role: 'primary' | 'backup'; signal: AbortSignal;
    maxOutputTokens: number }): Attempt;
}
