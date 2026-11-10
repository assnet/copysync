import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { planPresetRows } from '../src/modules/tenants/domain/planPresets';
import { entitlementJsonValue } from '../src/modules/integrations/billing/entitlementJsonValue';
import { isAdminEditableEntitlementKey } from '../src/modules/tenants/domain/adminEditableEntitlements';

const prisma = new PrismaClient();

const PASSWORD = 'Teste123@321';

const TENANTS = [
  { slug: 'acme-corp', name: 'Acme Corp' },
  { slug: 'beta-labs', name: 'Beta Labs' },
  // Contas isoladas: um tenant por usuário (mesmo modelo do ProvisionTenantUseCase)
  { slug: 'pedro-rodrigues', name: 'Pedro Rodrigues' },
  { slug: 'israel-daywis', name: 'Israel Daywis' },
] as const;

const TENANT_USERS = [
  { email: 'admin-acme@copysync.app', name: 'Admin Acme', tenantSlug: 'acme-corp', role: 'ADMIN' },
  { email: 'admin-beta@copysync.app', name: 'Admin Beta', tenantSlug: 'beta-labs', role: 'ADMIN' },
  // Contas comuns: dono (ADMIN) só do próprio tenant, isSuperAdmin=false; não enxergam Acme/Beta.
  // exclusive: remove qualquer vínculo com outro tenant (ex.: OPERATOR no acme-corp deixado por seed antigo)
  { email: 'pedrorodrigues.silva5@gmail.com', name: 'Pedro Rodrigues', tenantSlug: 'pedro-rodrigues', role: 'ADMIN', exclusive: true },
  { email: 'eu.israeldaywis@gmail.com', name: 'Israel Daywis', tenantSlug: 'israel-daywis', role: 'ADMIN', exclusive: true },
] as const;

/** Hosts aceitos sem `SEED_ALLOW_REMOTE=1`: máquina local e serviços do docker-compose. */
const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'postgres', 'db']);

/** Seed grava contas com senha conhecida: banco remoto (ex.: Render) só com opt-in explícito. */
function assertLocalDatabase(): void {
  const url = process.env.DATABASE_URL ?? '';
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = '';
  }
  if (LOCAL_DB_HOSTS.has(host) || process.env.SEED_ALLOW_REMOTE === '1') return;
  throw new Error(
    `Seed abortado: DATABASE_URL aponta para "${host || 'host desconhecido'}", que não é banco local. ` +
      'Use um banco local ou defina SEED_ALLOW_REMOTE=1 se tiver certeza.',
  );
}

async function main(): Promise<void> {
  assertLocalDatabase();
  console.log('🌱  Starting seed...\n');

  const passwordHash = await hash(PASSWORD, 10);

  // ── Super Admin (acesso global, associado a todos os tenants) ─────────────
  const superAdmin = await prisma.user.upsert({
    where: { email: 'copysyncapp@gmail.com' },
    // Senha só na criação: rodar o seed de novo não redefine a senha de conta existente
    update: {},
    create: {
      email: 'copysyncapp@gmail.com',
      name: 'Super Admin',
      passwordHash,
      isSuperAdmin: true,
    },
  });
  console.log(`✅  Super admin: ${superAdmin.email} (${superAdmin.id})`);

  // ── Tenants ───────────────────────────────────────────────────────────────
  const tenantMap = new Map<string, string>();

  for (const t of TENANTS) {
    const tenant = await prisma.tenant.upsert({
      where: { slug: t.slug },
      update: {},
      create: { name: t.name, slug: t.slug, status: 'ACTIVE' },
    });
    tenantMap.set(t.slug, tenant.id);
    console.log(`✅  Tenant: ${tenant.name} (${tenant.id})`);

    // Super admin vê todos os tenants
    await prisma.userTenant.upsert({
      where: { userId_tenantId: { userId: superAdmin.id, tenantId: tenant.id } },
      update: {},
      create: { userId: superAdmin.id, tenantId: tenant.id, role: 'SUPER_ADMIN' },
    });
  }

  // ── Usuários por tenant (admin ou operador; cada um só vê o seu) ──────────
  for (const a of TENANT_USERS) {
    const tenantId = tenantMap.get(a.tenantSlug);
    if (!tenantId) throw new Error(`Tenant ${a.tenantSlug} not found`);

    const user = await prisma.user.upsert({
      where: { email: a.email },
      // Senha só na criação (idem)
      update: {},
      create: {
        email: a.email,
        name: a.name,
        passwordHash,
        isSuperAdmin: false,
      },
    });

    await prisma.userTenant.upsert({
      where: { userId_tenantId: { userId: user.id, tenantId } },
      update: { role: a.role },
      create: { userId: user.id, tenantId, role: a.role },
    });

    if ('exclusive' in a && a.exclusive) {
      const removed = await prisma.userTenant.deleteMany({
        where: { userId: user.id, tenantId: { not: tenantId } },
      });
      if (removed.count > 0) console.log(`🧹  ${user.email}: removido de ${removed.count} outro(s) tenant(s)`);
    }

    console.log(`✅  ${a.role}: ${user.email} → tenant ${a.tenantSlug} (${tenantId})`);
  }

  // ── Entitlements por tenant ──────────────────────────────────────────────
  const ENTITLEMENT_KEYS = [
    { key: 'marketplace_extension', value: true },
    { key: 'max_sessions', value: 3 },
    { key: 'max_campaigns', value: 10 },
  ] as const;

  for (const [, tenantId] of tenantMap) {
    for (const ent of ENTITLEMENT_KEYS) {
      await prisma.tenantEntitlement.upsert({
        where: { tenantId_key: { tenantId, key: ent.key } },
        update: { value: ent.value },
        create: { tenantId, key: ent.key, value: ent.value },
      });
    }
  }
  console.log(`✅  Entitlements: ${ENTITLEMENT_KEYS.map(e => e.key).join(', ')} → todos os tenants`);

  // ── Plan presets (usados pelo billing sync) ──────────────────────────────
  // Tabela única em src/modules/tenants/domain/planPresets.ts (travada por teste contra a vitrine)
  const PLAN_PRESETS = planPresetRows();

  // Chave editável pelo super admin: o seed só cria, nunca desfaz a liberação feita pela rota admin
  for (const p of PLAN_PRESETS) {
    await prisma.planEntitlementPreset.upsert({
      where: { planSlug_key: { planSlug: p.planSlug, key: p.key } },
      update: isAdminEditableEntitlementKey(p.key) ? {} : { value: entitlementJsonValue(p.value) },
      create: { planSlug: p.planSlug, key: p.key, value: entitlementJsonValue(p.value) },
    });
  }
  console.log(`✅  Plan presets: marketplace_extension → STARTER, PROFISSIONAL, BUSINESS`);

  console.log(`\n🎯  Seed concluído. Senha padrão (só contas criadas agora): ${PASSWORD}`);
  console.log('    Super admin: copysyncapp@gmail.com (vê todos os tenants)');
  console.log('    Admin Acme:  admin-acme@copysync.app (só Acme Corp)');
  console.log('    Admin Beta:  admin-beta@copysync.app (só Beta Labs)');
  console.log('    Pedro:       pedrorodrigues.silva5@gmail.com (só tenant pedro-rodrigues)');
  console.log('    Israel:      eu.israeldaywis@gmail.com (só tenant israel-daywis)');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
