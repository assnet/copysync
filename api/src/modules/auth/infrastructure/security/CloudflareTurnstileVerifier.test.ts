import { describe, expect, it, vi } from 'vitest';
import { CloudflareTurnstileVerifier } from './CloudflareTurnstileVerifier';

const reply = (json: unknown) => vi.fn(async () => new Response(JSON.stringify(json))) as unknown as typeof fetch;

describe('CloudflareTurnstileVerifier', () => {
  it('envia secret, token e IP; aceita sucesso com action login ou sem action (secret de teste)', async () => {
    const f = reply({ success: true, action: 'login' });
    expect((await new CloudflareTurnstileVerifier('s', f).verify('tok', '1.2.3.4')).success).toBe(true);
    const body = (f as unknown as { mock: { calls: [string, { body: URLSearchParams }][] } }).mock.calls[0][1].body;
    expect(body.get('secret')).toBe('s');
    expect(body.get('remoteip')).toBe('1.2.3.4');
    expect((await new CloudflareTurnstileVerifier('s', reply({ success: true })).verify('tok', null)).success).toBe(true);
  });
  it('falha-fechado: action de outro widget, success false e erro de rede', async () => {
    expect((await new CloudflareTurnstileVerifier('s', reply({ success: true, action: 'checkout' })).verify('t', null)).success).toBe(false);
    expect((await new CloudflareTurnstileVerifier('s', reply({ success: false })).verify('t', null)).success).toBe(false);
    const boom = vi.fn(async () => { throw new TypeError('net'); }) as unknown as typeof fetch;
    expect(await new CloudflareTurnstileVerifier('s', boom).verify('t', null)).toEqual({ success: false, errorCodes: ['network-error'] });
  });
});
