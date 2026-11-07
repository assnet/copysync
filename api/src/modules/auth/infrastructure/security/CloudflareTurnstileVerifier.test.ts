import { describe, expect, it, vi } from 'vitest';
import { CloudflareTurnstileVerifier } from './CloudflareTurnstileVerifier';

const reply = (json: unknown) => vi.fn(async () => new Response(JSON.stringify(json))) as unknown as typeof fetch;
const TEST_SECRET = `1x${'0'.repeat(31)}AA`;
const make = (json: unknown, secret = 'real-secret') => new CloudflareTurnstileVerifier(secret, { fetchFn: reply(json), expectedHostname: 'app.copysync.app' });

describe('CloudflareTurnstileVerifier', () => {
  it('envia secret, token e IP; aceita action login no host do painel', async () => {
    const f = reply({ success: true, action: 'login', hostname: 'app.copysync.app' });
    expect((await new CloudflareTurnstileVerifier('s', { fetchFn: f, expectedHostname: 'app.copysync.app' }).verify('tok', '1.2.3.4')).success).toBe(true);
    const body = (f as unknown as { mock: { calls: [string, { body: URLSearchParams }][] } }).mock.calls[0][1].body;
    expect(body.get('secret')).toBe('s');
    expect(body.get('remoteip')).toBe('1.2.3.4');
  });
  it('exige action login e hostname do painel (secret real)', async () => {
    expect(await make({ success: true, hostname: 'app.copysync.app' }).verify('t', null)).toEqual({ success: false, errorCodes: ['action-mismatch'] });
    expect(await make({ success: true, action: 'checkout', hostname: 'app.copysync.app' }).verify('t', null)).toMatchObject({ success: false });
    expect(await make({ success: true, action: 'login', hostname: 'evil.com' }).verify('t', null)).toEqual({ success: false, errorCodes: ['hostname-mismatch'] });
  });
  it('secret de teste da Cloudflare dispensa action/hostname', async () => {
    expect((await make({ success: true }, TEST_SECRET).verify('t', null)).success).toBe(true);
  });
  it('falha-fechado: success false e erro de rede', async () => {
    expect((await make({ success: false, action: 'login', hostname: 'app.copysync.app' }).verify('t', null)).success).toBe(false);
    const boom = vi.fn(async () => { throw new TypeError('net'); }) as unknown as typeof fetch;
    expect(await new CloudflareTurnstileVerifier('s', { fetchFn: boom }).verify('t', null)).toEqual({ success: false, errorCodes: ['network-error'] });
  });
});
