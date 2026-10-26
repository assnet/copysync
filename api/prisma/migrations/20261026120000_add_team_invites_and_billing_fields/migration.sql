-- AlterTable: Tenant — billing and suspension fields
ALTER TABLE "tenants" ADD COLUMN "billingCustomerId" TEXT;
ALTER TABLE "tenants" ADD COLUMN "suspendedAt" TIMESTAMP(3);

-- CreateIndex: unique on billingCustomerId (nullable unique — nulls don't collide)
CREATE UNIQUE INDEX "tenants_billingCustomerId_key" ON "tenants"("billingCustomerId");

-- AlterTable: User — nullable passwordHash + passwordSetAt
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN "passwordSetAt" TIMESTAMP(3);

-- CreateTable: UserInvite
CREATE TABLE "user_invites" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OPERATOR',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "invitedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique on tokenHash
CREATE UNIQUE INDEX "user_invites_tokenHash_key" ON "user_invites"("tokenHash");

-- CreateIndex: tenant + email lookup
CREATE INDEX "user_invites_tenantId_email_idx" ON "user_invites"("tenantId", "email");

-- AddForeignKey: UserInvite → Tenant
ALTER TABLE "user_invites" ADD CONSTRAINT "user_invites_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
