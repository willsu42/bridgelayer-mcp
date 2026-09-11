import { z } from 'zod';

// Runtime schemas are the source of truth; TypeScript types are inferred below.
const customerId = z.string().regex(/^CUST-[0-9]{5}$/, 'Expected CUST- followed by five digits');
export const customerInput = z.strictObject({ customer_id: customerId });
export const refundInput = z.strictObject({
  customer_id: customerId,
  amount: z.number().finite().positive(),
  reason: z.string().trim().min(10),
});

export type RefundInput = z.infer<typeof refundInput>;
