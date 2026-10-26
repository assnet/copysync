import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

const PASSWORD = 'Teste123@321';

const TENANTS = [
  { slug: 'acme-corp', name: 'Acme Corp' },
  { slug: 'beta-labs', name: 'Beta Labs' },
] as const;

const ADMINS = [
  { email: 'admin-acme@copysync.app', name: 'Admin Acme', tenantSlug: 'acme-corp' },
  { email: 'admin-beta@copysync.app', name: 'Admin Beta', tenantSlug: 'beta-labs' },
] as const;

async function main(): Promise<void> {
  console.log('🌱  Starting seed...\n');

  const passwordHash = await hash(PASSWORD, 10);

  // ── Super Admin (acesso global, associado a todos os tenants) ─────────────
  const superAdmin = await prisma.user.upsert({
    where: { email: 'copysyncapp@gmail.com' },
    update: { passwordHash },
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

  // ── Admin por tenant (cada um só vê o seu) ────────────────────────────────
  for (const a of ADMINS) {
    const tenantId = tenantMap.get(a.tenantSlug);
    if (!tenantId) throw new Error(`Tenant ${a.tenantSlug} not found`);

    const user = await prisma.user.upsert({
      where: { email: a.email },
      update: { passwordHash },
      create: {
        email: a.email,
        name: a.name,
        passwordHash,
        isSuperAdmin: false,
      },
    });

    await prisma.userTenant.upsert({
      where: { userId_tenantId: { userId: user.id, tenantId } },
      update: {},
      create: { userId: user.id, tenantId, role: 'ADMIN' },
    });

    console.log(`✅  Admin: ${user.email} → tenant ${a.tenantSlug} (${tenantId})`);
  }

  console.log(`\n🎯  Seed concluído. Senha padrão: ${PASSWORD}`);
  console.log('    Super admin: copysyncapp@gmail.com (vê todos os tenants)');
  console.log('    Admin Acme:  admin-acme@copysync.app (só Acme Corp)');
  console.log('    Admin Beta:  admin-beta@copysync.app (só Beta Labs)');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
