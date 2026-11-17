import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { UsageMetricsReadUnavailableError } from '../../../../shared/errors/internal/UsageMetricsErrors';
import { FEATURE_USAGE_CATALOG } from '../../domain/services/featureUsageCatalog';
import { PrismaLiveFeatureUsageReader } from './PrismaLiveFeatureUsageReader';
import { createReadBudget, translateUsageReadError } from './featureUsageReadTimeout';

/**
 * Leitura do uso nas tabelas de domínio contra o Postgres descartável, com a sessão do banco em
 * `America/Sao_Paulo` (≠ UTC) para provar o dia de Brasília e o instante UTC explícito.
 * Período: 01 a 07/03/2026 em Brasília = [03-01 03:00Z, 03-08 03:00Z).
 */
const reader = new PrismaLiveFeatureUsageReader(prisma);
const s = `um${Date.now().toString(36)}`;
const A = `${s}-ta`;
const B = `${s}-tb`;
const U1 = `${s}-u1`;
const U2 = `${s}-u2`;
let dbName = '';
let n = 0;
const id = (p: string) => `${s}-${p}${n++}`;
const run = (sql: string) => prisma.$executeRawUnsafe(sql);

const offer = async (tenant: string, origin: string, at: string) => {
  const oid = id('o');
  await run(`INSERT INTO offers (id, "tenantId", provider, "sourceUrl", "affiliateUrl", text, origin, "createdAt", "updatedAt")
    VALUES ('${oid}', '${tenant}', 'SHOPEE', 'x', 'x', 'x', '${origin}', '${at}', now())`);
  return oid;
};
const dispatch = async (tenant: string, offerId: string, status: string, at: string) => {
  const cid = id('c');
  await run(`INSERT INTO chat_conversations (id, "tenantId", "updatedAt") VALUES ('${cid}', '${tenant}', now())`);
  await run(`INSERT INTO offer_dispatches (id, "tenantId", "offerId", "conversationId", status, "notBefore", "updatedAt")
    VALUES ('${id('d')}', '${tenant}', '${offerId}', '${cid}', '${status}', now(), '${at}')`);
};
const huntRun = (tenant: string, trigger: string, status: string, at: string) =>
  run(`INSERT INTO offer_hunt_runs (id, "tenantId", trigger, status, "startedAt") VALUES ('${id('h')}', '${tenant}', '${trigger}', '${status}', '${at}')`);
const ai = (tenant: string, purpose: string, success: boolean, at: string) =>
  run(`INSERT INTO ai_usage_logs (id, "tenantId", source, kind, model, purpose, success, "createdAt")
    VALUES ('${id('ai')}', '${tenant}', 'PLATFORM', 'OPENAI', 'm', '${purpose}', ${success}, '${at}')`);
const session = async (tenant: string, engine: string, at: string, deleted = false) => {
  const sid = id('s');
  await run(`INSERT INTO sessions (id, "tenantId", name, engine, "createdAt", "updatedAt", "deletedAt")
    VALUES ('${sid}', '${tenant}', 'x', '${engine}', '${at}', now(), ${deleted ? 'now()' : 'NULL'})`);
  return sid;
};
const audit = (tenant: string | null, action: string, at: string, meta = 'NULL') =>
  run(`INSERT INTO audit_logs (id, "tenantId", action, meta, "createdAt")
    VALUES ('${id('al')}', ${tenant ? `'${tenant}'` : 'NULL'}, '${action}', ${meta}, '${at}')`);
const login = (type: string, userId: string | null, at: string) =>
  run(`INSERT INTO login_events (id, type, email, "userId", "createdAt") VALUES ('${id('le')}', '${type}', 'x', ${userId ? `'${userId}'` : 'NULL'}, '${at}')`);

const input = (budget = createReadBudget()) => ({
  from: new Date('2026-03-01T03:00:00Z'),
  toExclusive: new Date('2026-03-08T03:00:00Z'),
  featureKeys: FEATURE_USAGE_CATALOG.map((f) => f.key),
  granularity: 'day' as const,
  budget,
});

beforeAll(async () => {
  dbName = (await prisma.$queryRaw<{ d: string }[]>`SELECT current_database() AS d`)[0]!.d;
  await prisma.$executeRawUnsafe(`ALTER DATABASE "${dbName}" SET timezone = 'America/Sao_Paulo'`);
  await prisma.$disconnect();

  for (const t of [A, B]) await run(`INSERT INTO tenants (id, name, slug, "updatedAt") VALUES ('${t}', 'x', '${t}', now())`);
  for (const u of [U1, U2]) await run(`INSERT INTO users (id, email, name, "updatedAt") VALUES ('${u}', '${u}@x.test', 'x', now())`);
  for (const [u, t] of [[U1, A], [U1, B], [U2, A]] as const)
    await run(`INSERT INTO user_tenants (id, "userId", "tenantId", "updatedAt") VALUES ('${id('ut')}', '${u}', '${t}', now())`);

  // offers: 02:30 UTC de 03/03 é 23:30 de 02/03 em Brasília
  const gen = await offer(A, 'GENERATOR', '2026-03-02 15:00:00');
  await offer(A, 'GENERATOR', '2026-03-02 16:00:00');
  await offer(A, 'GENERATOR', '2026-03-03 02:30:00');
  await offer(A, 'MONITORING', '2026-03-04 12:00:00');
  const hunter = await offer(A, 'HUNTER', '2026-03-04 12:00:00');
  await offer(A, 'GENERATOR', '2020-01-10 12:00:00'); // fora do período: só primeiro dado
  await offer(A, 'MONITORING', '2019-05-05 12:00:00'); // monitoramento mais antigo não vira primeiro dado do gerador
  const genB = await offer(B, 'GENERATOR', '2026-03-05 12:00:00');

  await dispatch(A, hunter, 'SENT', '2026-03-04 13:00:00'); // envio do Caçador conta
  await dispatch(A, gen, 'SENT', '2026-03-04 14:00:00');
  await dispatch(A, gen, 'FAILED', '2026-03-04 15:00:00');
  await dispatch(B, genB, 'SENT', '2026-03-06 12:00:00');

  await huntRun(A, 'MANUAL', 'SUCCEEDED', '2026-03-02 12:00:00');
  await huntRun(A, 'SCHEDULED', 'SUCCEEDED', '2026-03-02 13:00:00');
  await huntRun(A, 'SCHEDULED', 'SKIPPED', '2026-03-02 14:00:00');
  await huntRun(A, 'MANUAL', 'SKIPPED', '2018-01-01 12:00:00'); // pulada não entra no primeiro dado

  await ai(A, 'offer.text', true, '2026-03-03 12:00:00');
  await ai(A, 'offer.text', false, '2026-03-03 12:00:00');
  await ai(A, 'offer_story_headline', true, '2026-03-03 12:00:00');

  const linkSession = await session(A, 'baileys', '2026-03-01 12:00:00');
  await session(A, 'telegram', '2026-03-02 12:00:00');
  await session(A, 'baileys', '2026-03-03 12:00:00', true); // removida também conta
  await session(B, 'engine-futura', '2026-03-03 12:00:00'); // engine desconhecida = WhatsApp
  await session(A, 'baileys', '2021-02-02 12:00:00');

  const domain = id('dom');
  await run(`INSERT INTO link_domains (id, hostname, "updatedAt") VALUES ('${domain}', '${domain}.test', now())`);
  const rotation = id('lr');
  await run(`INSERT INTO link_rotations (id, "tenantId", "sessionId", "domainId", slug, "createdAt", "updatedAt")
    VALUES ('${rotation}', '${A}', '${linkSession}', '${domain}', 'x', '2026-03-05 12:00:00', now())`);
  for (let i = 0; i < 2; i++)
    await run(`INSERT INTO link_clicks (id, "tenantId", "rotationId", "ipHash", "userAgentClass", "createdAt")
      VALUES ('${id('lc')}', '${A}', '${rotation}', 'h', 'browser', '2026-03-06 12:00:00')`);

  const store = id('sf');
  await run(`INSERT INTO storefronts (id, "tenantId", title, "updatedAt") VALUES ('${store}', '${A}', 'x', now())`);
  for (const [st, pos] of [['DRAFT', 1], ['PUBLISHED', 2]] as const)
    await run(`INSERT INTO storefront_offers (id, "tenantId", "storefrontId", status, position, provider, "sourceUrl", "affiliateUrl", title, "createdAt", "updatedAt")
      VALUES ('${id('so')}', '${A}', '${store}', '${st}', ${pos}, 'SHOPEE', 'x', 'x', 'x', '2026-03-04 12:00:00', now())`);

  await run(`INSERT INTO saver_extractions (id, "tenantId", trigger, status, "createdAt") VALUES ('${id('se')}', '${B}', 'MANUAL', 'DONE', '2026-03-05 12:00:00')`);

  await audit(A, 'AFFILIATE_CREDENTIAL_UPSERTED', '2026-03-02 12:00:00');
  await audit(A, 'AFFILIATE_SESSION_SYNCED', '2026-03-02 12:00:00');
  await audit(null, 'AFFILIATE_CREDENTIAL_UPSERTED', '2026-03-02 12:00:00');
  await audit(B, 'SAVER_EXPORTED', '2026-03-05 12:00:00', `'{"completed": true}'`);
  await audit(B, 'SAVER_EXPORTED', '2026-03-05 13:00:00', `'{"completed": false}'`);

  await login('LOGIN_OK', U1, '2026-03-06 12:00:00'); // usuário em 2 contas conta nas 2
  await login('LOGIN_CODE_VERIFIED', U2, '2026-03-06 13:00:00');
  await login('LOGIN_FAILED', U2, '2026-03-06 14:00:00');
  await login('LOGIN_OK', null, '2026-03-06 15:00:00');
});

afterAll(async () => {
  const like = `'${s}-%'`;
  for (const t of ['offer_dispatches', 'chat_conversations', 'offers', 'offer_hunt_runs', 'ai_usage_logs', 'link_clicks', 'link_rotations', 'link_domains', 'storefront_offers', 'storefronts', 'sessions', 'saver_extractions', 'audit_logs', 'login_events', 'user_tenants', 'users', 'tenants'])
    await run(`DELETE FROM ${t} WHERE id LIKE ${like}`);
  await prisma.$executeRawUnsafe(`ALTER DATABASE "${dbName}" SET timezone = 'UTC'`);
  await prisma.$disconnect();
});

describe('PrismaLiveFeatureUsageReader', () => {
  it('conta cada recurso por dia × conta, no dia de Brasília, com a sessão do banco fora de UTC', async () => {
    const tz = await prisma.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`;
    expect(tz[0]!.tz).toBe('America/Sao_Paulo');
    const spy = vi.spyOn(prisma, '$transaction');
    const out = await reader.read(input());
    expect(spy).toHaveBeenCalledTimes(12);

    const mine = out.rows.filter((r) => r.tenantId === A || r.tenantId === B);
    for (const r of mine) {
      expect(typeof r.uses).toBe('number');
      expect(typeof r.day).toBe('string');
      expect(r.activeDays).toBe(1);
      expect(r.lastDay).toBe(r.day);
    }
    const got = mine.map((r) => `${r.featureKey}|${r.kind}|${r.tenantId === A ? 'A' : 'B'}|${r.day}|${r.uses}`).sort();
    expect(got).toEqual(
      [
        'offer_generator|ACTION|A|2026-03-02|3',
        'offer_generator|ACTION|B|2026-03-05|1',
        'group_monitoring|AUTOMATIC|A|2026-03-04|1',
        'offer_dispatch|AUTOMATIC|A|2026-03-04|2',
        'offer_dispatch|AUTOMATIC|B|2026-03-06|1',
        'offer_hunter|ACTION|A|2026-03-02|1',
        'offer_hunter|AUTOMATIC|A|2026-03-02|1',
        'ai_rewrite|AUTOMATIC|A|2026-03-03|1',
        'offer_story|ACTION|A|2026-03-03|1',
        'whatsapp_session|ACTION|A|2026-03-01|1',
        'whatsapp_session|ACTION|A|2026-03-03|1',
        'whatsapp_session|ACTION|B|2026-03-03|1',
        'telegram_session|ACTION|A|2026-03-02|1',
        'link_rotation|ACTION|A|2026-03-05|1',
        'link_rotation_click|AUDIENCE|A|2026-03-06|2',
        'storefront|ACTION|A|2026-03-04|2',
        'saver_extraction|ACTION|B|2026-03-05|1',
        'affiliate_credentials|ACTION|A|2026-03-02|1',
        'extension_sync|ACTION|A|2026-03-02|1',
        'saver_export|ACTION|B|2026-03-05|1',
        'panel_login|ACCESS|A|2026-03-06|2',
        'panel_login|ACCESS|B|2026-03-06|1',
      ].sort(),
    );
    expect(out.rows.some((r) => !r.tenantId)).toBe(false); // auditoria sem conta não conta
  });

  it('primeiro dado por recurso, fora do período e com o mesmo filtro de classificação', async () => {
    const { firstDataDay } = await reader.read(input());
    expect(firstDataDay.offer_generator).toBe('2020-01-10');
    expect(firstDataDay.group_monitoring).toBe('2019-05-05');
    expect(firstDataDay.offer_hunter).toBe('2026-03-02');
    expect(firstDataDay.whatsapp_session).toBe('2021-02-02');
    expect(firstDataDay.telegram_session).toBe('2026-03-02');
    expect(firstDataDay.offer_dispatch).toBe('2026-03-04');
    expect(firstDataDay.saver_export).toBe('2026-03-05');
    expect(Object.keys(firstDataDay).sort()).toEqual(FEATURE_USAGE_CATALOG.map((f) => f.key).sort());
  });

  it('statement_timeout real do banco (SQLSTATE 57014) vira UsageMetricsReadUnavailableError', async () => {
    const err = await prisma
      .$transaction([prisma.$executeRawUnsafe('SET LOCAL statement_timeout = 50'), prisma.$queryRaw`SELECT pg_sleep(1)`])
      .then(() => null, (e: unknown) => e);
    expect(err).not.toBeNull();
    expect(translateUsageReadError(err)).toBeInstanceOf(UsageMetricsReadUnavailableError);
  });

  it('orçamento quase no fim: leitura lança 503 em vez de esperar', async () => {
    const tiny = { remainingMs: () => 1, track: () => undefined, settled: async () => undefined };
    await expect(reader.read(input(tiny))).rejects.toBeInstanceOf(UsageMetricsReadUnavailableError);
  });
});
