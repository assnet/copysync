import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../shared/config/env', () => ({
  env: { BILLING_APPLICATION_SECRET: 'env-current', BILLING_APPLICATION_SECRET_PREVIOUS: undefined, BILLING_HMAC_TOLERANCE_SECONDS: 300 },
}));

import { verifyBillingHmac } from './verifyBillingHmac';

const body = Buffer.from('{"eventId":"e1"}');
const nowTs = () => String(Math.floor(Date.now() / 1000));
const sign = (secret: string, ts: string) =>
  `sha256=${createHmac('sha256', secret).update(`${ts}.${body.toString('utf8')}`).digest('hex')}`;

describe('verifyBillingHmac', () => {
  it('sem segredo anterior: só o atual vale (comportamento de hoje)', () => {
    const ts = nowTs();
    expect(verifyBillingHmac(sign('cur', ts), ts, body, { current: 'cur' })).toEqual({ valid: true, matched: 'current' });
    expect(verifyBillingHmac(sign('old', ts), ts, body, { current: 'cur' })).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  it('com segredo anterior: aceita os dois e informa qual casou', () => {
    const ts = nowTs();
    const secrets = { current: 'cur', previous: 'old' };
    expect(verifyBillingHmac(sign('cur', ts), ts, body, secrets)).toEqual({ valid: true, matched: 'current' });
    expect(verifyBillingHmac(sign('old', ts), ts, body, secrets)).toEqual({ valid: true, matched: 'previous' });
    expect(verifyBillingHmac(sign('other', ts), ts, body, secrets)).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  it('anterior sem atual não vale: falta o segredo principal', () => {
    const ts = nowTs();
    expect(verifyBillingHmac(sign('old', ts), ts, body, { previous: 'old' })).toEqual({ valid: false, reason: 'missing_secret' });
  });

  it('assinatura de tamanho diferente e cabeçalhos/timestamp inválidos são rejeitados', () => {
    const ts = nowTs();
    const secrets = { current: 'cur', previous: 'old' };
    expect(verifyBillingHmac('sha256=abc', ts, body, secrets).reason).toBe('signature_mismatch');
    expect(verifyBillingHmac(undefined, ts, body, secrets).reason).toBe('missing_headers');
    expect(verifyBillingHmac(sign('cur', 'x'), 'x', body, secrets).reason).toBe('invalid_timestamp');
    const old = String(Math.floor(Date.now() / 1000) - 1000);
    expect(verifyBillingHmac(sign('old', old), old, body, secrets).reason).toBe('timestamp_expired');
  });

  it('sem argumentos usa os segredos e a tolerância do env', () => {
    const ts = nowTs();
    expect(verifyBillingHmac(sign('env-current', ts), ts, body)).toEqual({ valid: true, matched: 'current' });
  });

  it('o resultado nunca carrega o segredo', () => {
    const ts = nowTs();
    const r = verifyBillingHmac(sign('old', ts), ts, body, { current: 'cur-secret', previous: 'old-secret' });
    expect(JSON.stringify(r)).not.toMatch(/secret/);
  });
});
