import { describe, it, expect } from 'vitest';
import { createHmac, createHash } from 'node:crypto';
import { signHubRequest } from './hmacSigner';

describe('signHubRequest', () => {
  const applicationKey = 'app-key-001';
  const secret = 'test-secret-256-bits-long-enough';

  it('produces valid HMAC with canonical format', () => {
    const result = signHubRequest({
      method: 'POST',
      path: '/events',
      body: '{"type":"installed"}',
      applicationKey,
      secret,
    });

    expect(result['X-Application-Key']).toBe(applicationKey);
    expect(result['X-Timestamp']).toBeTruthy();
    expect(result['X-Nonce']).toMatch(/^[0-9a-f-]{36}$/);
    expect(result['X-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);

    const bodyHash = createHash('sha256').update('{"type":"installed"}').digest('hex');
    const canonical = [
      'POST',
      '/events',
      '',
      result['X-Timestamp'],
      result['X-Nonce'],
      bodyHash,
    ].join('\n');
    const expected = 'sha256=' + createHmac('sha256', secret).update(canonical).digest('hex');
    expect(result['X-Signature']).toBe(expected);
  });

  it('handles empty body', () => {
    const result = signHubRequest({
      method: 'GET',
      path: '/health',
      applicationKey,
      secret,
    });

    const bodyHash = createHash('sha256').update('').digest('hex');
    const canonical = [
      'GET',
      '/health',
      '',
      result['X-Timestamp'],
      result['X-Nonce'],
      bodyHash,
    ].join('\n');
    const expected = 'sha256=' + createHmac('sha256', secret).update(canonical).digest('hex');
    expect(result['X-Signature']).toBe(expected);
  });

  it('includes query string in canonical', () => {
    const result = signHubRequest({
      method: 'GET',
      path: '/events',
      query: 'after=abc&limit=10',
      applicationKey,
      secret,
    });

    const bodyHash = createHash('sha256').update('').digest('hex');
    const canonical = [
      'GET',
      '/events',
      'after=abc&limit=10',
      result['X-Timestamp'],
      result['X-Nonce'],
      bodyHash,
    ].join('\n');
    const expected = 'sha256=' + createHmac('sha256', secret).update(canonical).digest('hex');
    expect(result['X-Signature']).toBe(expected);
  });

  it('uppercases method', () => {
    const result = signHubRequest({
      method: 'post',
      path: '/events',
      body: '{}',
      applicationKey,
      secret,
    });

    const bodyHash = createHash('sha256').update('{}').digest('hex');
    const canonical = [
      'POST',
      '/events',
      '',
      result['X-Timestamp'],
      result['X-Nonce'],
      bodyHash,
    ].join('\n');
    const expected = 'sha256=' + createHmac('sha256', secret).update(canonical).digest('hex');
    expect(result['X-Signature']).toBe(expected);
  });

  it('X-Timestamp em segundos (canônica da central), não ISO', () => {
    const before = Math.floor(Date.now() / 1000);
    const result = signHubRequest({ method: 'POST', path: '/events', body: '{}', applicationKey, secret });
    expect(result['X-Timestamp']).toMatch(/^\d{10}$/);
    expect(Number(result['X-Timestamp'])).toBeGreaterThanOrEqual(before);
  });

  it('ordena a query na canônica', () => {
    const a = signHubRequest({ method: 'GET', path: '/events', query: 'limit=10&after=abc', applicationKey, secret });
    const canonical = ['GET', '/events', 'after=abc&limit=10', a['X-Timestamp'], a['X-Nonce'], createHash('sha256').update('').digest('hex')].join('\n');
    expect(a['X-Signature']).toBe('sha256=' + createHmac('sha256', secret).update(canonical).digest('hex'));
  });

  it('generates unique nonce per call', () => {
    const a = signHubRequest({ method: 'POST', path: '/events', applicationKey, secret });
    const b = signHubRequest({ method: 'POST', path: '/events', applicationKey, secret });
    expect(a['X-Nonce']).not.toBe(b['X-Nonce']);
  });
});
