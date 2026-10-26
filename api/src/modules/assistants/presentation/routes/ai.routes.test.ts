import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { aiAdminRoutes, aiTenantRoutes } from './ai.routes';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { UpdateAiSettingsUseCase } from '../../application/use-cases/AiSettingsUseCases';
import { CreateAiPlatformProviderUseCase, ListAiPlatformProvidersUseCase } from '../../application/use-cases/AiPlatformProviderUseCases';
import { UpsertTenantAiCredentialUseCase } from '../../application/use-cases/TenantAiCredentialUseCases';
import { GetAiStatusUseCase } from '../../application/use-cases/GetAiStatusUseCase';
import { TestTenantAiCredentialUseCase } from '../../application/use-cases/TestAiProviderUseCases';
import type { AiPlatformProvider } from '../../domain/entities/AiPlatformProvider';

/* Contrato HTTP com Fastify real, sem banco: hooks falsos e use cases espionados no protótipo. */
const user = vi.hoisted(() => ({ isSuperAdmin: true }));
vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));
vi.mock('../../../../shared/http/hooks/authHook', () => ({
  authHook: async (request: { user?: unknown }) => {
    request.user = { userId: 'user-a', isSuperAdmin: user.isSuperAdmin };
  },
}));
vi.mock('../../../../shared/http/hooks/tenantHook', () => ({
  tenantHook: async (request: { tenantContext?: unknown }) => {
    request.tenantContext = { userId: 'user-a', tenantId: 'tenant-a', role: 'ADMIN', isSuperAdmin: false };
  },
}));

const provider = (extra: Record<string, unknown> = {}): AiPlatformProvider => ({
  id: 'p1', kind: 'ANTHROPIC', label: 'Main', model: 'claude-haiku-5-5', enabled: true, priority: 0,
  dailyLimitPerTenant: null, hasKey: true, createdAt: new Date(0), updatedAt: new Date(0), ...extra,
});

let app: FastifyInstance;

beforeEach(async () => {
  user.isSuperAdmin = true;
  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(aiAdminRoutes, { prefix: '/api/admin/ai' });
  await app.register(aiTenantRoutes, { prefix: '/api/ai' });
  await app.ready();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

describe('/admin/ai', () => {
  it('exige super admin', async () => {
    user.isSuperAdmin = false;
    const list = vi.spyOn(ListAiPlatformProvidersUseCase.prototype, 'execute');
    const res = await app.inject({ method: 'GET', url: '/api/admin/ai/providers' });
    expect(res.statusCode).toBe(401);
    expect(list).not.toHaveBeenCalled();
  });

  it('PUT /settings repassa o 422 do invariante', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/admin/ai/settings', payload: { platformEnabled: false, tenantKeysEnabled: false },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'AI_MODES_BOTH_DISABLED' } });
  });

  it('PUT /settings exige os dois campos', async () => {
    const execute = vi.spyOn(UpdateAiSettingsUseCase.prototype, 'execute');
    const res = await app.inject({ method: 'PUT', url: '/api/admin/ai/settings', payload: { platformEnabled: true } });
    expect(res.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it('POST /providers: 201, contexto do usuário e nada de chave na resposta', async () => {
    const execute = vi.spyOn(CreateAiPlatformProviderUseCase.prototype, 'execute')
      .mockResolvedValue({ ...provider(), apiKey: 'sk-never-out' } as AiPlatformProvider);
    const payload = { kind: 'ANTHROPIC', label: 'Main', apiKey: 'sk-never-out' };
    const res = await app.inject({ method: 'POST', url: '/api/admin/ai/providers', payload });
    expect(res.statusCode).toBe(201);
    expect(res.body).not.toContain('sk-never-out');
    expect(res.json().data).toMatchObject({ id: 'p1', hasKey: true, createdAt: '1970-01-01T00:00:00.000Z' });
    expect(execute).toHaveBeenCalledWith({ ...payload, userId: 'user-a' });
  });

  it('POST /providers descarta campo desconhecido (removeAdditional) e recusa tipo inválido', async () => {
    const execute = vi.spyOn(CreateAiPlatformProviderUseCase.prototype, 'execute').mockResolvedValue(provider());
    const extra = await app.inject({
      method: 'POST', url: '/api/admin/ai/providers', payload: { kind: 'ANTHROPIC', label: 'x', apiKey: 'sk-abcdefgh', foo: 1 },
    });
    expect(extra.statusCode).toBe(201);
    expect(execute).toHaveBeenCalledWith({ kind: 'ANTHROPIC', label: 'x', apiKey: 'sk-abcdefgh', userId: 'user-a' });
    execute.mockClear();
    const kind = await app.inject({
      method: 'POST', url: '/api/admin/ai/providers', payload: { kind: 'GEMINI', label: 'x', apiKey: 'k' },
    });
    expect(kind.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it('PATCH /providers/:id vazio → 400', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/admin/ai/providers/p1', payload: {} });
    expect(res.statusCode).toBe(400);
  });
});

describe('/ai', () => {
  it('GET /status no formato do spec', async () => {
    const data = {
      mode: 'TENANT' as const, tenantKeysAllowed: true, platformAvailable: false,
      credential: { kind: 'OPENAI' as const, model: 'gpt-4o-mini', masked: '••••', enabled: true },
    };
    const execute = vi.spyOn(GetAiStatusUseCase.prototype, 'execute').mockResolvedValue(data);
    const res = await app.inject({ method: 'GET', url: '/api/ai/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data });
    expect(execute).toHaveBeenCalledWith('tenant-a');
  });

  it('GET /status com credential null', async () => {
    vi.spyOn(GetAiStatusUseCase.prototype, 'execute').mockResolvedValue({
      mode: 'NONE', tenantKeysAllowed: false, platformAvailable: false, credential: null,
    });
    const res = await app.inject({ method: 'GET', url: '/api/ai/status' });
    expect(res.json().data.credential).toBeNull();
  });

  it('PUT /credential devolve a credencial mascarada', async () => {
    const execute = vi.spyOn(UpsertTenantAiCredentialUseCase.prototype, 'execute').mockResolvedValue({
      tenantId: 'tenant-a', kind: 'OPENAI', model: 'gpt-4o-mini', enabled: true, updatedAt: new Date(0),
    });
    const res = await app.inject({ method: 'PUT', url: '/api/ai/credential', payload: { kind: 'OPENAI', apiKey: 'sk-tenant-x' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ kind: 'OPENAI', model: 'gpt-4o-mini', masked: '••••', enabled: true });
    expect(res.body).not.toContain('sk-tenant-x');
    expect(execute).toHaveBeenCalledWith({ kind: 'OPENAI', apiKey: 'sk-tenant-x', tenantId: 'tenant-a', userId: 'user-a' });
  });

  it('POST /credential/test devolve { ok, errorCode }', async () => {
    vi.spyOn(TestTenantAiCredentialUseCase.prototype, 'execute').mockResolvedValue({ ok: false, errorCode: 'AI_PROVIDER_REJECTED' });
    const res = await app.inject({ method: 'POST', url: '/api/ai/credential/test' });
    expect(res.json()).toEqual({ success: true, data: { ok: false, errorCode: 'AI_PROVIDER_REJECTED' } });
  });
});
