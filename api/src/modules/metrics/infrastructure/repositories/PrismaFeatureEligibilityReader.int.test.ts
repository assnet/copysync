import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { FEATURE_USAGE_CATALOG, findFeature } from '../../domain/services/featureUsageCatalog';
import { PrismaFeatureEligibilityReader, eligibilitySnapshotSql } from './PrismaFeatureEligibilityReader';
import { createReadBudget, type UsageReadPrisma } from './featureUsageReadTimeout';

/** Direito ao recurso por conta (P3): regra de acesso de `tenants` + entitlement (conta, senão preset do plano). */
/** Audiência liberada (as asserções de direito abaixo); a audiência "Só super admin" tem caso próprio. */
const reader = new PrismaFeatureEligibilityReader(prisma, () => ({ offer_hunter_enabled: false, saver: false }));
const s = `fel${Date.now().toString(36)}`;
const T = {
  legacyMax: `${s}-legacymax`, // sem linha em tenant_products, plano MAX sem entitlements gravados
  affOff: `${s}-affoff`, // Afiliados INACTIVE
  saver: `${s}-saver`, // só Saver ativo
  proNoStore: `${s}-pronostore`, // PRO com storefront_enabled = false gravado
  lite: `${s}-lite`, // LITE: preset sem vitrine, Story, Caçador e Telegram
  internal: `${s}-internal`, // MAX legado com membro super admin
};
const run = (sql: string) => prisma.$executeRawUnsafe(sql);
let n = 0;
const tenant = (id: string, planSlug: string | null) =>
  run(`INSERT INTO tenants (id, name, slug, "planSlug", "updatedAt") VALUES ('${id}', 'x', '${id}', ${planSlug ? `'${planSlug}'` : 'NULL'}, now())`);
const product = (tenantId: string, product: string, status: string, planSlug: string | null) =>
  run(`INSERT INTO tenant_products (id, "tenantId", product, status, "planSlug", source, "updatedAt")
    VALUES ('${s}-p${n++}', '${tenantId}', '${product}', '${status}', ${planSlug ? `'${planSlug}'` : 'NULL'}, 'ADMIN', now())`);
const entitlement = (tenantId: string, key: string, json: string) =>
  run(`INSERT INTO tenant_entitlements (id, "tenantId", key, value) VALUES ('${s}-e${n++}', '${tenantId}', '${key}', '${json}'::jsonb)`);

beforeAll(async () => {
  await tenant(T.legacyMax, 'COPYSYNC_MAX');
  await tenant(T.affOff, 'COPYSYNC_MAX');
  await product(T.affOff, 'AFFILIATES', 'INACTIVE', 'COPYSYNC_MAX');
  await tenant(T.saver, null);
  await product(T.saver, 'SAVER', 'ACTIVE', 'SAVER_PRO');
  await product(T.saver, 'AFFILIATES', 'INACTIVE', null);
  await tenant(T.proNoStore, 'COPYSYNC_PRO');
  await product(T.proNoStore, 'AFFILIATES', 'ACTIVE', 'COPYSYNC_PRO');
  await entitlement(T.proNoStore, 'storefront_enabled', 'false');
  await entitlement(T.proNoStore, 'telegram_sessions', '0');
  await tenant(T.lite, 'COPYSYNC_LITE');
  await tenant(T.internal, 'COPYSYNC_MAX');
  await run(`INSERT INTO users (id, email, name, "isSuperAdmin", "updatedAt") VALUES ('${s}-u', '${s}@x.test', 'x', true, now())`);
  await run(`INSERT INTO user_tenants (id, "userId", "tenantId", role, "updatedAt") VALUES ('${s}-ut', '${s}-u', '${T.internal}', 'ADMIN', now())`);
});

afterAll(async () => {
  await run(`DELETE FROM user_tenants WHERE id LIKE '${s}-%'`);
  await run(`DELETE FROM users WHERE id LIKE '${s}-%'`);
  await run(`DELETE FROM platform_settings WHERE key = 'feature_audience'`);
  await run(`DELETE FROM tenants WHERE id LIKE '${s}-%'`);
  await prisma.$disconnect();
});

const only = (set: Set<string> | undefined) => [...(set ?? [])].filter((id) => id.startsWith(s)).sort();

describe('PrismaFeatureEligibilityReader', () => {
  it('conta legado sem linha em tenant_products tem Afiliados e não tem Saver', async () => {
    const out = await reader.read(FEATURE_USAGE_CATALOG, createReadBudget());
    expect(out.get('offer_generator')!.has(T.legacyMax)).toBe(true);
    expect(out.get('saver_extraction')!.has(T.legacyMax)).toBe(false);
    expect(only(out.get('saver_export'))).toEqual([T.saver]);
  });

  it('recurso de CHAT usa a linha de AFFILIATES: Afiliados inativo tira o direito ao chat', async () => {
    const out = await reader.read([findFeature('chat_send')!], createReadBudget());
    // Chat só para conta interna (menu do Chat é só de super admin)
    expect(only(out.get('chat_send'))).toEqual([T.internal]);
    expect(out.get('chat_send')!.has(T.affOff)).toBe(false);
    expect(out.get('chat_send')!.has(T.saver)).toBe(false);
  });

  it('storefront_enabled = false gravado tira a conta do denominador da Página de Ofertas; ausente segue o preset', async () => {
    const out = await reader.read(FEATURE_USAGE_CATALOG, createReadBudget());
    // MAX legado sem a chave: preset MAX libera; LITE: preset bloqueia; PRO com `false` gravado: bloqueia
    expect(only(out.get('storefront'))).toEqual([T.internal, T.legacyMax].sort());
    expect(only(out.get('offer_story'))).toEqual([T.internal, T.legacyMax].sort());
    expect(only(out.get('offer_hunter'))).toEqual([T.internal, T.legacyMax].sort());
    // Telegram (sessão é da conta, sem produto): `0` gravado bloqueia o PRO; LITE pelo preset (0); sem plano e sem a
    // chave = ilimitado (na conta real o merge entre produtos grava a chave)
    expect(only(out.get('telegram_session'))).toEqual([T.affOff, T.internal, T.legacyMax, T.saver].sort());
    // Reescrita por IA: LITE `false` no preset; PRO sem a chave usa o preset (true)
    expect(only(out.get('ai_rewrite'))).toEqual([T.internal, T.legacyMax, T.proNoStore].sort());
    // Sessão é da conta: todo mundo
    expect(only(out.get('whatsapp_session'))).toEqual(Object.values(T).sort());
  });

  it('leitura em lote: uma instrução só, sem nome nem consulta por conta', async () => {
    const spy = vi.spyOn(prisma, '$queryRaw');
    await reader.read(FEATURE_USAGE_CATALOG, createReadBudget());
    expect(spy).toHaveBeenCalledTimes(1);
    const sql = eligibilitySnapshotSql(['storefront_enabled']).sql;
    expect(sql).not.toMatch(/"name"|email/);
  });

  it('audiência "Só super admin": gravada vence o valor inicial; conta comum sai, interna fica', async () => {
    const onlyAdmin = new PrismaFeatureEligibilityReader(prisma, () => ({ offer_hunter_enabled: true, saver: true }));
    let out = await onlyAdmin.read(FEATURE_USAGE_CATALOG, createReadBudget());
    expect(only(out.get('offer_hunter'))).toEqual([T.internal]);
    expect(only(out.get('saver_export'))).toEqual([]);
    await run(`INSERT INTO platform_settings (key, value, "updatedAt") VALUES ('feature_audience', '{"saver": false}'::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    out = await onlyAdmin.read(FEATURE_USAGE_CATALOG, createReadBudget());
    expect(only(out.get('saver_export'))).toEqual([T.saver]);
    expect(only(out.get('offer_hunter'))).toEqual([T.internal]);
  });

  it('sem recurso pedido não vai ao banco', async () => {
    const fake = { $transaction: vi.fn(), $executeRawUnsafe: vi.fn(), $queryRaw: vi.fn() } as unknown as UsageReadPrisma;
    expect((await new PrismaFeatureEligibilityReader(fake).read([], createReadBudget())).size).toBe(0);
    expect(fake.$transaction).not.toHaveBeenCalled();
  });

  it('recursos sem chave de entitlement leem sem subconsulta de entitlements', async () => {
    const out = await reader.read([findFeature('offer_generator')!], createReadBudget());
    expect(only(out.get('offer_generator'))).toEqual([T.internal, T.legacyMax, T.lite, T.proNoStore].sort());
  });
});
