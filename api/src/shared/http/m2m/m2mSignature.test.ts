import { describe, expect, it } from 'vitest';
import vector from './__fixtures__/m2m-vector.json';
import { buildM2MCanonical, canonicalM2MQuery, m2mBodyHash, m2mTimestamp, signM2MCanonical, signM2MRequest } from './m2mSignature';

describe('assinatura M2M (vetor oficial da central)', () => {
  for (const v of vector.vectors) {
    it(v.name, () => {
      expect(canonicalM2MQuery(v.query)).toBe(v.canonicalQuery);
      expect(m2mBodyHash(v.method, v.body)).toBe(v.expectedBodyHash);
      const canonical = buildM2MCanonical({ method: v.method, path: v.path, query: v.query, timestamp: v.timestamp, nonce: v.nonce, body: v.body });
      expect(canonical).toBe(v.expectedCanonical);
      expect(signM2MCanonical(vector.secret, canonical)).toBe(v.expectedSignature);
    });
  }

  it('signM2MRequest reproduz o vetor com relógio e nonce fixos', () => {
    const v = vector.vectors[1];
    const h = signM2MRequest({
      method: 'post', path: v.path, body: v.body, applicationKey: 'copysync', secret: vector.secret,
      nowMs: Number(v.timestamp) * 1000 + 999, nonce: v.nonce,
    });
    expect(h).toEqual({ 'X-Application-Key': 'copysync', 'X-Timestamp': v.timestamp, 'X-Nonce': v.nonce, 'X-Signature': v.expectedSignature });
  });

  it('timestamp em segundos (10 dígitos) e nonce uuid v4 por chamada', () => {
    expect(m2mTimestamp(1762300800123)).toBe('1762300800');
    const a = signM2MRequest({ method: 'GET', path: '/x', applicationKey: 'k', secret: 's' });
    const b = signM2MRequest({ method: 'GET', path: '/x', applicationKey: 'k', secret: 's' });
    expect(a['X-Timestamp']).toMatch(/^\d{10}$/);
    expect(a['X-Nonce']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a['X-Nonce']).not.toBe(b['X-Nonce']);
  });
});
