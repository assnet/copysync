import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { resolveClientIp } from './clientIp';

describe('resolveClientIp', () => {
  it('usa cf-connecting-ip (IP real gravado pela borda Cloudflare), não o salto da borda', async () => {
    const app = Fastify({ trustProxy: 1 });
    app.get('/', async (req) => ({ ip: resolveClientIp(req) }));
    const res = await app.inject({
      method: 'GET', url: '/',
      headers: { 'x-forwarded-for': '6.6.6.6, 104.22.160.59', 'cf-connecting-ip': '203.0.113.7' },
    });
    expect(res.json().ip).toBe('203.0.113.7');
    await app.close();
  });

  it('cf-connecting-ip ausente ou inválido: cai para request.ip, nunca o 1º X-Forwarded-For', async () => {
    const app = Fastify({ trustProxy: 1 });
    app.get('/', async (req) => ({ ip: resolveClientIp(req) }));
    const res = await app.inject({
      method: 'GET', url: '/',
      headers: { 'x-forwarded-for': '6.6.6.6, 198.51.100.9', 'cf-connecting-ip': 'not-an-ip' },
    });
    expect(res.json().ip).toBe('198.51.100.9');
    await app.close();
  });

  it('IPv6 em cf-connecting-ip é aceito', () => {
    expect(resolveClientIp({ ip: '1.1.1.1', headers: { 'cf-connecting-ip': '2001:db8::1' } })).toBe('2001:db8::1');
  });

  it('sem nada: null', () => expect(resolveClientIp({ ip: '', headers: {} })).toBeNull());
});
