import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

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
  // Default dev password: Teste123@ — change before deploying to production.
  const passwordHash = await hash('Teste123@', 10);

  const superAdmin = await prisma.user.upsert({
    where: { email: 'assnet.developer@gmail.com' },
    update: { passwordHash },
    create: {
      email: 'assnet.developer@gmail.com',
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

  // ── Chat seed data ─────────────────────────────────────────────────────────
  // Verifica se já existe sessão para vincular
  const existingSession = await prisma.session.findFirst({
    where: { tenantId: tenant.id, deletedAt: null },
  });
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
