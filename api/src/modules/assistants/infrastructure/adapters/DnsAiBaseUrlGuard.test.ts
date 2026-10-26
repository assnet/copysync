import { describe, it, expect, vi } from 'vitest';
import { DnsAiBaseUrlGuard, isPublicAddress, type LookupAllFn } from './DnsAiBaseUrlGuard';

const answer = (...addresses: string[]) =>
  vi.fn<LookupAllFn>(async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));

describe('isPublicAddress', () => {
  it.each([
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '100.127.255.254', '127.0.0.1', '169.254.169.254', '172.16.0.1',
    '172.31.255.255', '192.168.1.1', '192.0.2.10', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1',
    '64:ff9b::a00:1', '2001:db8::1', 'not-an-ip',
  ])('bloqueia %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '2001:4860:4860::8888'])(
    'aceita %s', (ip) => {
      expect(isPublicAddress(ip)).toBe(true);
    },
  );
});

describe('DnsAiBaseUrlGuard', () => {
  it('ok quando todos os endereços são públicos', async () => {
    const lookup = answer('8.8.8.8', '2606:4700:4700::1111');
    expect(await new DnsAiBaseUrlGuard(lookup).check('https://api.example.com/v1')).toBe('ok');
    expect(lookup).toHaveBeenCalledWith('api.example.com');
  });

  it('blocked se qualquer endereço for privado', async () => {
    expect(await new DnsAiBaseUrlGuard(answer('8.8.8.8', '10.0.0.5')).check('https://api.example.com')).toBe('blocked');
  });

  it('unresolvable em falha ou resposta vazia', async () => {
    const fail = vi.fn<LookupAllFn>(async () => { throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' }); });
    expect(await new DnsAiBaseUrlGuard(fail).check('https://nope.example.com')).toBe('unresolvable');
    expect(await new DnsAiBaseUrlGuard(answer()).check('https://empty.example.com')).toBe('unresolvable');
  });

  it('rebinding: consulta de novo a cada chamada', async () => {
    let calls = 0;
    const lookup = vi.fn<LookupAllFn>(async () => [{ address: calls++ === 0 ? '8.8.8.8' : '127.0.0.1', family: 4 }]);
    const guard = new DnsAiBaseUrlGuard(lookup);
    expect(await guard.check('https://api.example.com')).toBe('ok');
    expect(await guard.check('https://api.example.com')).toBe('blocked');
  });
});
