import { issueDemoToken } from '../src/gateway/auth.js';

try {
  const secret = process.env.BRIDGELAYER_JWT_SECRET;
  const role = process.argv[2] ?? 'viewer';
  if (!secret || (role !== 'viewer' && role !== 'admin')) {
    throw new Error('Usage: set BRIDGELAYER_JWT_SECRET, then token viewer|admin [tenant] [subject]');
  }
  // This explicit credential-issuing CLI is the only place tokens go to stdout.
  console.log(await issueDemoToken(secret, {
    role, tenant_id: process.argv[3] ?? 'demo-tenant', sub: process.argv[4] ?? 'demo-user',
  }));
} catch {
  console.error('Cannot issue token: supply a 32-byte secret, viewer|admin role, and simple tenant/subject identifiers.');
  process.exitCode = 1;
}
