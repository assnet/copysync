import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../../shared/config/env';

export interface HmacVerifyResult {
  valid: boolean;
  reason?: string;
}

export function verifyBillingHmac(
  signature: string | undefined,
  timestamp: string | undefined,
  rawBody: Buffer,
): HmacVerifyResult {
  if (!signature || !timestamp) {
    return { valid: false, reason: 'missing_headers' };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return { valid: false, reason: 'invalid_timestamp' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const drift = Math.abs(nowSec - ts);
  if (drift > env.BILLING_HMAC_TOLERANCE_SECONDS) {
    return { valid: false, reason: 'timestamp_expired' };
  }

  const secret = env.BILLING_APPLICATION_SECRET;
  if (!secret) {
    return { valid: false, reason: 'missing_secret' };
  }

  const payload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  const expectedPrefixed = `sha256=${expected}`;

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedPrefixed);

  if (sigBuf.length !== expBuf.length) {
    return { valid: false, reason: 'signature_mismatch' };
  }

  if (!timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, reason: 'signature_mismatch' };
  }

  return { valid: true };
}
