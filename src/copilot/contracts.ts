import { z } from 'zod';

export const draftRequest = z.strictObject({
  customerId: z.string().regex(/^CUST-[0-9]{5}$/),
  caseType: z.enum(['account', 'billing', 'access']),
  issue: z.string().trim().min(10).max(1200).refine(value => !/[\uD800-\uDFFF]/u.test(value)),
  includeSampleEmail: z.boolean().default(true),
});
export type DraftRequest = z.infer<typeof draftRequest>;
export const customerRecord = z.strictObject({
  customer_id: z.string().regex(/^CUST-[0-9]{5}$/),
  name: z.string().min(1).max(120), email: z.string().max(254), plan: z.string().min(1).max(60),
});
export type CustomerSummary = Pick<z.infer<typeof customerRecord>, 'customer_id' | 'name' | 'plan'>;
export type DraftEvent =
  | { type: 'status'; data: { step: 'lookup' | 'generating' } }
  | { type: 'customer'; data: CustomerSummary }
  | { type: 'delta'; data: { text: string } }
  | { type: 'metrics'; data: { redactions: number; suppressions: number; outputBytes: number } };

export class CopilotError extends Error {
  constructor(readonly code: string, readonly status = 502) { super(code); }
}

// Selection metadata only. A successful MCP lookup is required before generating any draft.
export const catalog = {
  mode: 'scripted',
  customers: [
    { id: 'CUST-00001', name: 'Alex Rivera' },
    { id: 'CUST-00002', name: 'Sam Chen' },
    { id: 'CUST-00003', name: 'Jordan Taylor' },
  ],
  cases: [
    { id: 'account', title: 'Account question', description: 'Confirm the customer profile and prepare a reply.',
      issue: 'Please confirm my current plan and explain what information you need to help with my account question.' },
    { id: 'billing', title: 'Billing review', description: 'Acknowledge a reported charge without promising a refund.',
      issue: 'I noticed a charge I do not recognize. Could you help me understand what to provide for a billing review?' },
    { id: 'access', title: 'Access assistance', description: 'Prepare a response to a reported sign-in issue.',
      issue: 'I am having trouble signing in to my account. Please help me understand the next steps.' },
  ],
} as const;
