import { randomBytes, createHash } from 'node:crypto';

export function generateInviteToken(): { token: string; tokenHash: string } {
  const buf = randomBytes(32);
  const token = buf.toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
