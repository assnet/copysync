import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { featureUsageRoutes } from './featureUsage.routes';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { UnauthorizedError } from '../../../../shared/errors/internal/AuthErrors';
import { PrismaAuditLogRepository } from '../../../../shared/audit/PrismaAuditLogRepository';
import { PrismaLiveFeatureUsageReader } from '../../infrastructure/repositories/PrismaLiveFeatureUsageReader';
import { PrismaUsageTenantDirectory } from '../../infrastructure/repositories/PrismaUsageTenantDirectory';
import { PrismaDailyFeatureUsageReader } from '../../infrastructure/repositories/PrismaDailyFeatureUsageReader';
import { PrismaFeatureUsageRollupStateRepository } from '../../infrastructure/repositories/PrismaFeatureUsageRollupStateRepository';
import { PrismaFeatureEligibilityReader } from '../../infrastructure/repositories/PrismaFeatureEligibilityReader';
import { PrismaPageViewReader } from '../../infrastructure/repositories/PrismaPageViewReader';
import type { UsageTenantDirectoryEntry } from '../../domain/contracts/IUsageTenantDirectory';
import { resolveUsageQuery } from '../schemas/featureUsage.schema';

/* Contrato HTTP sem banco: Prisma vazio, auth falsa, leitor e diretório espionados no protótipo. */
const auth = vi.hoisted(() => ({ mode: 'super' as 'none' | 'user' | 'super' }));
vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));
vi.mock('../../../../shared/http/hooks/authHook', () => ({
  authHook: async (request: { user?: unknown }) => {
    if (auth.mode === 'none') throw new UnauthorizedError('Missing token');
    request.user = { userId: 'admin-1', isSuperAdmin: auth.mode === 'super' };
  },
}));

const URL = '/api/admin/usage';
const NOW = new Date('2026-11-17T15:00:00.000Z'); // 12:00 em Brasília
const tenant = (tenantId: string, extra: Partial<UsageTenantDirectoryEntry> = {}): UsageTenantDirectoryEntry => ({
  tenantId,
  affiliatesPlan: 'COPYSYNC_PRO',
  saverPlan: 'NONE',
  status: 'ACTIVE',
  internal: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...extra,
});
const TENANTS = [tenant('t1'), tenant('t2', { status: 'SUSPENDED' }), tenant('t3', { internal: true })];
const ROW = { day: '2026-11-10', tenantId: 't1', featureKey: 'offer_generator', kind: 'ACTION' as const, uses: 4, activeDays: 1, lastDay: '2026-11-10' };

let app: FastifyInstance;

beforeEach(async () => {
  auth.mode = 'super';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(featureUsageRoutes, { prefix: URL });
  await app.ready();
});

afterEach(async () => {
  vi.useRealTimers();
  await app.close();
});

function mockReads() {
  const read = vi.spyOn(PrismaLiveFeatureUsageReader.prototype, 'read').mockResolvedValue({ rows: [ROW], firstDataDay: { offer_generator: '2026-01-01' } });
  const list = vi.spyOn(PrismaUsageTenantDirectory.prototype, 'list').mockResolvedValue(TENANTS);
  const names = vi.spyOn(PrismaUsageTenantDirectory.prototype, 'names').mockResolvedValue(new Map([['t1', 'Conta Um']]));
  const audit = vi.spyOn(PrismaAuditLogRepository.prototype, 'create').mockResolvedValue();
  // Sem marco do backfill: fonte viva; o agregado só responde pelos recursos do contador (vazio aqui)
  const state = vi.spyOn(PrismaFeatureUsageRollupStateRepository.prototype, 'get')
    .mockResolvedValue({ backfillCompletedAt: null, backfilledFrom: null, backfillStopReason: null, backfillCursor: null, cutovers: {}, lastSuccessAt: null, finalizedThrough: null, failureStreak: 0 });
  const daily = vi.spyOn(PrismaDailyFeatureUsageReader.prototype, 'read').mockResolvedValue({ rows: [], firstDataDay: {} });
  // P3: direito ao recurso; t1 e t3 (interna) com direito ao gerador
  const eligibility = vi.spyOn(PrismaFeatureEligibilityReader.prototype, 'read').mockImplementation(async (features) =>
    new Map(features.map((f) => [f.key, new Set(f.key === 'offer_generator' ? ['t1', 't3'] : [])])),
  );
  return { read, list, names, audit, state, daily, eligibility };
}

describe('auth', () => {
  it.each(['/summary', '/features/offer_generator', '/features/offer_generator/tenants'])('%s sem token: 401 sem ler', async (path) => {
    const { read } = mockReads();
    auth.mode = 'none';
    const res = await app.inject({ method: 'GET', url: `${URL}${path}` });
    expect(res.statusCode).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['/summary', '/features/offer_generator', '/features/offer_generator/tenants'])('%s sem super admin: 401 UNAUTHORIZED', async (path) => {
    const { read } = mockReads();
    auth.mode = 'user';
    const res = await app.inject({ method: 'GET', url: `${URL}${path}` });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
    expect(read).not.toHaveBeenCalled();
  });
});

describe('GET /summary', () => {
  it('sem query: 200 com os padrões (30 dias até hoje em Brasília, ação+automático, ativas, sem internas, dia)', async () => {
    const { read } = mockReads();
    const res = await app.inject({ method: 'GET', url: `${URL}/summary` });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.range).toEqual({
      from: '2026-10-19',
      to: '2026-11-17',
      timeZone: 'America/Sao_Paulo',
      previousFrom: '2026-09-19',
      previousTo: '2026-10-18',
      granularity: 'day',
      maxDays: 90,
    });
    expect(data.source).toBe('live');
    expect(data.freshAt).toBe(NOW.toISOString());
    expect(data.population).toMatchObject({ tenants: 1, internalExcluded: 1 });
    const keys = data.features.map((f: { key: string }) => f.key);
    expect(keys).toContain('offer_hunter');
    expect(keys).not.toContain('panel_login');
    expect(keys).not.toContain('link_rotation_click');
    expect(read).toHaveBeenCalledTimes(1);
    // P3: só t1 no recorte com direito (t3 é interna); recorrência padrão N = 3; anterior sem uso
    expect(data.features.find((f: { key: string }) => f.key === 'offer_generator')).toMatchObject({
      uses: 4, activeTenants: 1, eligibleTenants: 1, adoption: 1, recurringTenants: 0, retainedTenants: 0,
    });
    expect(data.features.find((f: { key: string }) => f.key === 'storefront')).toMatchObject({ eligibleTenants: 0, adoption: null });
  });

  it('recurringDays 2, 3 e 5 aceitos; 4 = 400 de validação, sem ler', async () => {
    const { read, eligibility } = mockReads();
    for (const n of [2, 3, 5]) expect((await app.inject({ method: 'GET', url: `${URL}/summary?recurringDays=${n}` })).statusCode).toBe(200);
    read.mockClear();
    eligibility.mockClear();
    const res = await app.inject({ method: 'GET', url: `${URL}/summary?recurringDays=4` });
    expect(res.statusCode).toBe(400);
    expect(read).not.toHaveBeenCalled();
    expect(eligibility).not.toHaveBeenCalled();
  });

  it('N = 2 não conta quem usou em 1 dia; detalhe não lê o direito e sai null', async () => {
    const { eligibility } = mockReads();
    const two = await app.inject({ method: 'GET', url: `${URL}/summary?recurringDays=2` });
    expect(two.json().data.features.find((f: { key: string }) => f.key === 'offer_generator').recurringTenants).toBe(0);
    eligibility.mockClear();
    const detail = await app.inject({ method: 'GET', url: `${URL}/features/offer_generator` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.feature).toMatchObject({ eligibleTenants: null, adoption: null, recurringTenants: null, retainedTenants: null });
    expect(eligibility).not.toHaveBeenCalled();
  });

  it('sem tenantName, totals.uses nem activeUsers', async () => {
    mockReads();
    const res = await app.inject({ method: 'GET', url: `${URL}/summary` });
    expect(res.body).not.toMatch(/tenantName|activeUsers/);
    expect(res.json().data.totals).not.toHaveProperty('uses');
  });

  it('kind como lista separada por vírgula, produto e plano', async () => {
    const { read } = mockReads();
    const res = await app.inject({
      method: 'GET',
      url: `${URL}/summary?from=2026-11-01&to=2026-11-17&granularity=week&kind=ACCESS,ACTION&product=ACCESS&plan=NONE&tenantStatus=ALL&includeInternal=true&tenantId=t1`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.features.map((f: { key: string }) => f.key)).toEqual(['panel_login']);
    expect(read.mock.calls[0]![0].featureKeys).toEqual(['panel_login']);
  });

  it('91 dias: 400 USAGE_METRICS_RANGE_INVALID (use case)', async () => {
    mockReads();
    const res = await app.inject({ method: 'GET', url: `${URL}/summary?from=2026-08-19&to=2026-11-17&granularity=week` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('USAGE_METRICS_RANGE_INVALID');
  });

  it.each([
    ['401 dias', 'from=2025-10-13&to=2026-11-17&granularity=week'],
    ['granularity=day com 120 dias', 'from=2026-07-21&to=2026-11-17&granularity=day'],
    ['granularity=hora', 'granularity=hora'],
    ['plan fora da lista', 'plan=COPYSYNC_GOLD'],
    ['data malformada', 'from=2026-1-01'],
    ['kind inválido', 'kind=ACTION,FOO'],
    ['tenantStatus inválido', 'tenantStatus=DELETED'],
  ])('%s: 400 de validação', async (_label, qs) => {
    const { read, daily, state } = mockReads();
    const res = await app.inject({ method: 'GET', url: `${URL}/summary?${qs}` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('HTTP_ERROR');
    expect(read).not.toHaveBeenCalled();
    expect(daily).not.toHaveBeenCalled();
    expect(state).not.toHaveBeenCalled();
  });

  it('com o marco do backfill: 200 dias por semana respondem do agregado com teto 400', async () => {
    const { read, daily, state } = mockReads();
    state.mockResolvedValue({ backfillCompletedAt: new Date('2026-11-10T00:00:00Z'), backfilledFrom: '2025-10-26', backfillStopReason: 'RETENTION', backfillCursor: null, cutovers: {}, lastSuccessAt: new Date('2026-11-17T14:45:00Z'), finalizedThrough: null, failureStreak: 0 });
    daily.mockResolvedValue({ rows: [ROW], firstDataDay: { offer_generator: '2025-10-26' } });
    const res = await app.inject({ method: 'GET', url: `${URL}/summary?from=2026-05-02&to=2026-11-17&granularity=week` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ source: 'daily', freshAt: '2026-11-17T14:45:00.000Z', range: { maxDays: 400 } });
    expect(read).not.toHaveBeenCalled();
  });

  it('dois pedidos simultâneos: o segundo espera a vaga e os dois respondem 200', async () => {
    mockReads();
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    vi.spyOn(PrismaLiveFeatureUsageReader.prototype, 'read').mockImplementationOnce(async () => {
      await hold;
      return { rows: [], firstDataDay: {} };
    });
    const first = app.inject({ method: 'GET', url: `${URL}/summary` });
    await vi.waitFor(() => expect(PrismaLiveFeatureUsageReader.prototype.read).toHaveBeenCalled());
    const second = app.inject({ method: 'GET', url: `${URL}/summary` });
    release();
    const res = await Promise.all([first, second]);
    expect(res.map((r) => r.statusCode)).toEqual([200, 200]);
  });
});

describe('GET /features/:featureKey', () => {
  it('200 com o item e a série do recurso', async () => {
    mockReads();
    const res = await app.inject({ method: 'GET', url: `${URL}/features/offer_generator?from=2026-11-01&to=2026-11-17&granularity=day` });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.feature).toMatchObject({ key: 'offer_generator', uses: 4 });
    expect(data.inScope).toBe(true);
    expect(data.series).toHaveLength(17);
    expect(res.body).not.toMatch(/tenantName/);
  });

  it('tipo que exclui o recurso: 200 zerado com inScope false, sem ler', async () => {
    const { read } = mockReads();
    const res = await app.inject({ method: 'GET', url: `${URL}/features/panel_login` });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.inScope).toBe(false);
    expect(data.feature).toMatchObject({ key: 'panel_login', uses: 0, activeTenants: 0 });
    expect(data.series).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  it('chave fora do catálogo: 404 USAGE_METRICS_FEATURE_NOT_FOUND', async () => {
    const { read } = mockReads();
    const res = await app.inject({ method: 'GET', url: `${URL}/features/nao_existe` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('USAGE_METRICS_FEATURE_NOT_FOUND');
    expect(read).not.toHaveBeenCalled();
  });
});

describe('GET /features/:featureKey/tenants', () => {
  it('200 com id, nome e medidas; primeira página auditada', async () => {
    const { audit } = mockReads();
    const res = await app.inject({ method: 'GET', url: `${URL}/features/offer_generator/tenants` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({
      items: [
        {
          tenantId: 't1',
          tenantName: 'Conta Um',
          plan: 'COPYSYNC_PRO',
          status: 'ACTIVE',
          internal: false,
          uses: 4,
          activeDays: 1,
          lastUsedDay: '2026-11-10',
        },
      ],
      nextCursor: null,
    });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ userId: 'admin-1', action: 'USAGE_METRICS_VIEWED' }));
  });

  it('plano de outra família: 200 com lista vazia, sem ler nem auditar', async () => {
    const { read, audit } = mockReads();
    const res = await app.inject({ method: 'GET', url: `${URL}/features/offer_generator/tenants?plan=SAVER_MAX` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ items: [], nextCursor: null });
    expect(read).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('cursor amarrado às datas resolvidas: sem datas e com as mesmas datas explícitas valem o mesmo cursor', async () => {
    mockReads();
    const ids = Array.from({ length: 30 }, (_, i) => `t${String(i).padStart(2, '0')}`);
    vi.spyOn(PrismaUsageTenantDirectory.prototype, 'list').mockResolvedValue(ids.map((id) => tenant(id)));
    vi.spyOn(PrismaLiveFeatureUsageReader.prototype, 'read').mockResolvedValue({
      rows: ids.map((id) => ({ ...ROW, tenantId: id })),
      firstDataDay: { offer_generator: '2026-01-01' },
    });
    const p1 = await app.inject({ method: 'GET', url: `${URL}/features/offer_generator/tenants` });
    const cursor = p1.json().data.nextCursor as string;
    expect(cursor).toBeTruthy();
    const explicit = `${URL}/features/offer_generator/tenants?from=2026-10-19&to=2026-11-17&cursor=${encodeURIComponent(cursor)}`;
    const p2 = await app.inject({ method: 'GET', url: explicit });
    expect(p2.statusCode).toBe(200);
    expect(p2.json().data.items).toHaveLength(5);
    const shifted = await app.inject({ method: 'GET', url: explicit.replace('from=2026-10-19', 'from=2026-10-20') });
    expect(shifted.json().error.code).toBe('USAGE_METRICS_CURSOR_INVALID');
  });

  it('cursor inválido: 400 USAGE_METRICS_CURSOR_INVALID', async () => {
    mockReads();
    const res = await app.inject({ method: 'GET', url: `${URL}/features/offer_generator/tenants?cursor=abc~def` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('USAGE_METRICS_CURSOR_INVALID');
  });
});

describe('GET /screens', () => {
  it('sem super admin: 401 sem ler', async () => {
    mockReads();
    const views = vi.spyOn(PrismaPageViewReader.prototype, 'read');
    auth.mode = 'user';
    expect((await app.inject({ method: 'GET', url: `${URL}/screens` })).statusCode).toBe(401);
    expect(views).not.toHaveBeenCalled();
  });

  it('200: uma linha por tela, sem conta; não lê as linhas do resumo', async () => {
    const { read, daily, list } = mockReads();
    const views = vi.spyOn(PrismaPageViewReader.prototype, 'read').mockResolvedValue({
      rows: [{ key: 'view:offers', tenants: 1, tenantDays: 3 }],
      firstDataDay: '2026-11-10',
    });
    const res = await app.inject({ method: 'GET', url: `${URL}/screens?from=2026-11-01&to=2026-11-17` });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.screens[0]).toEqual({ key: 'view:offers', product: 'AFFILIATES', planFamily: 'AFFILIATES', tenants: 1, tenantDays: 3 });
    expect(data.firstDataDay).toBe('2026-11-10');
    expect(data.population).toEqual({ tenants: 1 });
    expect(res.body).not.toMatch(/tenantId|tenantName|"t1"/);
    expect(views).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
    expect(daily).not.toHaveBeenCalled();
  });
});

describe('resolveUsageQuery', () => {
  const base = { kind: 'ACTION,AUTOMATIC', tenantStatus: 'ACTIVE' as const, includeInternal: false };

  it('sem granularity: dia até 31 dias, semana acima (120 dias = week)', () => {
    expect(resolveUsageQuery({ ...base, from: '2026-10-18', to: '2026-11-17' }, NOW).granularity).toBe('day');
    expect(resolveUsageQuery({ ...base, from: '2026-10-17', to: '2026-11-17' }, NOW).granularity).toBe('week');
    expect(resolveUsageQuery({ ...base, from: '2026-07-21', to: '2026-11-17' }, NOW).granularity).toBe('week');
  });

  it('só `to`: 30 dias terminando nele', () => {
    expect(resolveUsageQuery({ ...base, to: '2026-11-10' }, NOW)).toMatchObject({ from: '2026-10-12', to: '2026-11-10' });
  });
});

describe('código da rota', () => {
  const src = readFileSync(join(__dirname, 'featureUsage.routes.ts'), 'utf8');
  const schema = readFileSync(join(__dirname, '../schemas/featureUsage.schema.ts'), 'utf8');

  it('handlers terminam em return da resposta e não há onSend novo', () => {
    expect(src.match(/async \(request, reply\) =>/g)).toHaveLength(4);
    expect(src.match(/return reply;/g)).toHaveLength(4);
    expect(src).not.toMatch(/onSend/);
  });

  it('OpenAPI sem a marca', () => {
    expect(`${src}\n${schema}`.replace(/COPYSYNC_(LITE|PRO|MAX)/g, '')).not.toMatch(/copysync|waioprime/i);
  });
});
