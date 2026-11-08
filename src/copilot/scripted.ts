import { setTimeout } from 'node:timers/promises';
import { frame, type Provider } from '../streaming/provider.js';
import type { CustomerSummary, DraftRequest } from './contracts.js';

export function scriptedDraft(customer: CustomerSummary, request: DraftRequest, delayMs = 35): Provider {
  const guidance = {
    account: 'Please share the specific account setting or feature you need help with so our support team can review it.',
    billing: 'Please share the date and amount of the charge, along with an invoice reference if available. Our support team can review those details. This reply does not confirm a billing error or approve a refund.',
    access: 'Please share the sign-in error message and when it occurred. Do not send your password or verification codes. Our support team can use that information to investigate.',
  }[request.caseType];
  const text = `Hi ${customer.name},\n\nThank you for contacting us. Your customer profile lists the ${customer.plan} plan.\n\n` +
    `You wrote:\n“${request.issue}”\n\n${guidance}\n\n` +
    (request.includeSampleEmail ? 'For follow-up, contact support@example.com.\n\n' : '') +
    'Best regards,\nCustomer Support';
  return { async *open({ signal }) {
    // Short fragments deliberately split email tokens. The production guardrail decides what can be released.
    const chars = Array.from(text);
    for (let offset = 0; offset < chars.length; offset += 9) {
      signal.throwIfAborted();
      await setTimeout(delayMs, undefined, { signal });
      yield Buffer.from(frame('delta', { text: chars.slice(offset, offset + 9).join('') }));
    }
    signal.throwIfAborted();
    yield Buffer.from(frame('done', {}));
  } };
}
