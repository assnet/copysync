import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { extensionAuthHook } from './extensionAuthHook';
import { ValidateExtensionSessionUseCase } from '../application/use-cases/ValidateExtensionSessionUseCase';
import { extensionRequestGuard } from './extensionRequestGuard';

// Regressão: hook async que responde sem `return reply` deixava o Fastify seguir para o
// handler — TypeError sem sessão + ERR_HTTP_HEADERS_SENT, que derrubava a API. Só reproduz
// com `onSend` async (como em app.ts): eles adiam a escrita, e `reply.sent` ainda é false
// quando o Fastify decide chamar o handler.
async function buildApp() {
  const handler = vi.fn(async () => ({ ok: true }));
  const app = Fastify();
  app.addHook('onSend', async (_req, reply) => { reply.header('x-a', '1'); });
  app.addHook('onSend', async (_req, reply) => { reply.header('x-b', '1'); });
  app.post('/heartbeat', { onRequest: [extensionRequestGuard], preHandler: [extensionAuthHook] }, handler);
  await app.ready();
  return { app, handler };
}

const UUID = 'e3814c80-a096-4fe5-8039-0612dfaeb2af';

describe('hooks da extensão param a requisição', () => {
  it('sem cookie: 401 e o handler não roda', async () => {
    const { app, handler } = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/heartbeat', headers: { 'x-client': 'extension', 'x-installation-id': UUID } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('MISSING_EXT_SESSION');
    expect(handler).not.toHaveBeenCalled();
  });

  it('sem X-Client: 403 e nem o auth hook nem o handler rodam', async () => {
    const { app, handler } = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/heartbeat' });
    expect(res.statusCode).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it('X-Installation-Id inválido: 400 e o handler não roda', async () => {
    const { app, handler } = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/heartbeat', headers: { 'x-client': 'extension', 'x-installation-id': 'x' } });
    expect(res.statusCode).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  // Reinstalar a extensão troca o installationId mas o cookie fica: sessão da instalação antiga não vale.
  const session = { id: 's1', userId: 'u1', installationId: UUID, mlTenantId: 't1', mlConsentAt: null, sheinConsentAt: null, tokenHash: 'h' };
  const cookie = { cookie: 'ext_session=tok; __Host-ext_session=tok' };

  it('cookie de outra instalação (extensão reinstalada): 401 e o handler não roda', async () => {
    vi.spyOn(ValidateExtensionSessionUseCase.prototype, 'execute').mockResolvedValue({ session } as never);
    const { app, handler } = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/heartbeat', headers: { ...cookie, 'x-client': 'extension', 'x-installation-id': 'aaaaaaaa-a096-4fe5-8039-0612dfaeb2af' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_EXT_SESSION');
    expect(handler).not.toHaveBeenCalled();
  });

  it('cookie da mesma instalação: passa', async () => {
    vi.spyOn(ValidateExtensionSessionUseCase.prototype, 'execute').mockResolvedValue({ session } as never);
    const { app, handler } = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/heartbeat', headers: { ...cookie, 'x-client': 'extension', 'x-installation-id': UUID } });
    expect(res.statusCode).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
