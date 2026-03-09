import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/shared/utils/hash';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('🌱  Starting seed...');

  // ── Create default tenant ──────────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'default' },
    update: {},
    create: {
      name: 'Default Tenant',
      slug: 'default',
      status: 'ACTIVE',
    },
  });

  console.log(`✅  Tenant: ${tenant.name} (${tenant.id})`);

  // ── Create super-admin user ────────────────────────────────────────────────
  // Default dev password: admin123 — change before deploying to production.
  const passwordHash = await hashPassword('admin123');

  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@washoot.dev' },
    update: { passwordHash },
    create: {
      email: 'admin@washoot.dev',
      name: 'Super Admin',
      passwordHash,
      isSuperAdmin: true,
    },
  });

  console.log(`✅  Super admin: ${superAdmin.email} (${superAdmin.id})`);

  // ── Associate super-admin with default tenant ──────────────────────────────
  await prisma.userTenant.upsert({
    where: { userId_tenantId: { userId: superAdmin.id, tenantId: tenant.id } },
    update: {},
    create: {
      userId: superAdmin.id,
      tenantId: tenant.id,
      role: 'SUPER_ADMIN',
    },
  });

  console.log(`✅  UserTenant association created`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
