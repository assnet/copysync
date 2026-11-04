import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../../shared/config/env';

/** Qual segredo validou a assinatura. Só o rótulo vai para log — nunca o segredo. */
export type HmacSecretSlot = 'current' | 'previous';

export interface HmacVerifyResult {
  valid: boolean;
  reason?: string;
  matched?: HmacSecretSlot;
}

export interface HmacSecrets {
  current?: string;
  /** Segredo anterior, aceito só durante a rotação. Ausente = só o atual vale. */
  previous?: string;
}

function signatureMatches(sigBuf: Buffer, payload: string, secret: string): boolean {
  const expBuf = Buffer.from(`sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`);
  // Comprimento esperado é fixo (sha256 hex), então a checagem não revela nada do segredo
  return sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
}

export function verifyBillingHmac(
  signature: string | undefined,
  timestamp: string | undefined,
  rawBody: Buffer,
  secrets: HmacSecrets = {
    current: env.BILLING_APPLICATION_SECRET,
    previous: env.BILLING_APPLICATION_SECRET_PREVIOUS,
  },
  toleranceSeconds: number = env.BILLING_HMAC_TOLERANCE_SECONDS,
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
  if (drift > toleranceSeconds) {
    return { valid: false, reason: 'timestamp_expired' };
  }

  if (!secrets.current) {
    return { valid: false, reason: 'missing_secret' };
  }

  const payload = `${timestamp}.${rawBody.toString('utf8')}`;
  const sigBuf = Buffer.from(signature);

  // Sempre compara contra os dois (sem curto-circuito): o tempo não revela qual segredo casou
  const currentOk = signatureMatches(sigBuf, payload, secrets.current);
  const previousOk = secrets.previous ? signatureMatches(sigBuf, payload, secrets.previous) : false;

  if (currentOk) return { valid: true, matched: 'current' };
  if (previousOk) return { valid: true, matched: 'previous' };
  return { valid: false, reason: 'signature_mismatch' };
}
