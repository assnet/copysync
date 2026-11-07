import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { resolveClientIp } from './clientIp';

describe('resolveClientIp', () => {
  it('com trustProxy 1: salto do proxy (último X-Forwarded-For), nunca o 1º nem cf-connecting-ip', async () => {
    const app = Fastify({ trustProxy: 1 });
    app.get('/', async (req) => ({ ip: resolveClientIp(req) }));
    const res = await app.inject({
      method: 'GET', url: '/',
      headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7', 'cf-connecting-ip': '9.9.9.9' },
    });
    expect(res.json().ip).toBe('203.0.113.7');
    await app.close();
  });
  it('sem ip: null', () => expect(resolveClientIp({ ip: '' })).toBeNull());
});
