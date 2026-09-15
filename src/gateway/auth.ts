import { createHash, timingSafeEqual } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';

export const DEMO_ISSUER = 'bridgelayer-demo';
export const DEMO_AUDIENCE = 'bridgelayer-gateway';
const identity = z.object({
  sub: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  tenant_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  role: z.enum(['viewer', 'admin']),
});
export type Identity = z.infer<typeof identity>;

export function secretBytes(secret: string): Uint8Array {
  if (Buffer.byteLength(secret) < 32) throw new Error('Credentials must contain at least 32 bytes');
  return new TextEncoder().encode(secret);
}

export function serviceKeyMatches(provided: string | undefined, expected: string): boolean {
  if (!provided || provided.length > 1024) return false;
  const hash = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(provided), hash(expected));
}

export async function verifyToken(authorization: string | undefined, secret: string): Promise<Identity> {
  if (!authorization || authorization.length > 8192 || !/^Bearer [^\s]+$/i.test(authorization)) {
    throw new Error('Invalid credentials');
  }
  const { payload } = await jwtVerify(authorization.slice(7), secretBytes(secret), {
    algorithms: ['HS256'], typ: 'JWT', issuer: DEMO_ISSUER, audience: DEMO_AUDIENCE,
    requiredClaims: ['sub', 'exp', 'iat', 'tenant_id', 'role'],
    maxTokenAge: '15m', clockTolerance: 0,
  });
  if (typeof payload.exp !== 'number' || typeof payload.iat !== 'number' || payload.exp - payload.iat > 900) {
    throw new Error('Invalid lifetime');
  }
  return identity.parse(payload);
}

export async function issueDemoToken(secret: string, claims: Identity): Promise<string> {
  return new SignJWT(identity.parse(claims)).setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(DEMO_ISSUER).setAudience(DEMO_AUDIENCE).setIssuedAt().setExpirationTime('15m')
    .sign(secretBytes(secret));
}
