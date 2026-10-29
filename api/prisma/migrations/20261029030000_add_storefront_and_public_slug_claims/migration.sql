-- Página de Ofertas (storefront) e namespace público único <slug>.<domínio>:
-- public_slug_claims (dono único do slug por domínio; rodízio OU página, CHECK abaixo),
-- premium_slug_grants (liberação de nome premium de link_domains.premiumNames por tenant),
-- storefronts (uma por tenant; domínio/slug vêm do claim) e storefront_offers.
-- No fim: backfill de claims dos rodízios existentes, preset storefront_enabled (false explícito
-- no Starter) e backfill de tenant_entitlements para tenants com plano. Tudo idempotente
-- (ON CONFLICT DO NOTHING); o backfill de claims é repetido após o deploy (janela de instância antiga).

-- CreateEnum
CREATE TYPE "PublicSlugKind" AS ENUM ('LINK_ROTATION', 'STOREFRONT');

-- CreateEnum
CREATE TYPE "PremiumSlugGrantSource" AS ENUM ('MANUAL', 'BILLING');

-- CreateEnum
CREATE TYPE "StorefrontStatus" AS ENUM ('ACTIVE', 'PAUSED_BY_PLAN');

-- CreateEnum
CREATE TYPE "StorefrontOfferStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- AlterTable
ALTER TABLE "link_domains" ADD COLUMN     "premiumNames" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "public_slug_claims" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "PublicSlugKind" NOT NULL,
    "tenantId" TEXT NOT NULL,
    "linkRotationId" TEXT,
    "storefrontId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_slug_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "premium_slug_grants" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" "PremiumSlugGrantSource" NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "premium_slug_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storefronts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "avatarUrl" TEXT,
    "coverUrl" TEXT,
    "colorPrimary" TEXT NOT NULL DEFAULT '#2563EB',
    "colorBackground" TEXT NOT NULL DEFAULT '#F5F5F5',
    "colorCard" TEXT NOT NULL DEFAULT '#FFFFFF',
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "StorefrontStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefronts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storefront_offers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storefrontId" TEXT NOT NULL,
    "status" "StorefrontOfferStatus" NOT NULL DEFAULT 'DRAFT',
    "position" INTEGER NOT NULL,
    "provider" "AffiliateProvider" NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "affiliateUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "priceCents" INTEGER,
    "originalPriceCents" INTEGER,
    "imageUrl" TEXT,
    "category" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefront_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "public_slug_claims_linkRotationId_key" ON "public_slug_claims"("linkRotationId");

-- CreateIndex
CREATE UNIQUE INDEX "public_slug_claims_storefrontId_key" ON "public_slug_claims"("storefrontId");

-- CreateIndex
CREATE INDEX "public_slug_claims_tenantId_idx" ON "public_slug_claims"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "public_slug_claims_domainId_slug_key" ON "public_slug_claims"("domainId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "premium_slug_grants_domainId_slug_key" ON "premium_slug_grants"("domainId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "storefronts_tenantId_key" ON "storefronts"("tenantId");

-- CreateIndex
CREATE INDEX "storefront_offers_storefrontId_status_position_idx" ON "storefront_offers"("storefrontId", "status", "position");

-- CreateIndex
CREATE INDEX "storefront_offers_tenantId_idx" ON "storefront_offers"("tenantId");

-- AddForeignKey
ALTER TABLE "public_slug_claims" ADD CONSTRAINT "public_slug_claims_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "link_domains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_slug_claims" ADD CONSTRAINT "public_slug_claims_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_slug_claims" ADD CONSTRAINT "public_slug_claims_linkRotationId_fkey" FOREIGN KEY ("linkRotationId") REFERENCES "link_rotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_slug_claims" ADD CONSTRAINT "public_slug_claims_storefrontId_fkey" FOREIGN KEY ("storefrontId") REFERENCES "storefronts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "premium_slug_grants" ADD CONSTRAINT "premium_slug_grants_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "link_domains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "premium_slug_grants" ADD CONSTRAINT "premium_slug_grants_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefronts" ADD CONSTRAINT "storefronts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_offers" ADD CONSTRAINT "storefront_offers_storefrontId_fkey" FOREIGN KEY ("storefrontId") REFERENCES "storefronts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_offers" ADD CONSTRAINT "storefront_offers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CHECK: exatamente um dono, coerente com kind
ALTER TABLE "public_slug_claims" ADD CONSTRAINT "public_slug_claims_owner_check" CHECK (
  ("kind" = 'LINK_ROTATION' AND "linkRotationId" IS NOT NULL AND "storefrontId" IS NULL)
  OR ("kind" = 'STOREFRONT' AND "storefrontId" IS NOT NULL AND "linkRotationId" IS NULL)
);

-- Backfill: 1 claim por rodízio existente (@default(cuid()) não existe no banco)
INSERT INTO "public_slug_claims" ("id", "domainId", "slug", "kind", "tenantId", "linkRotationId", "createdAt")
SELECT gen_random_uuid()::text, "domainId", "slug", 'LINK_ROTATION', "tenantId", "id", now() FROM "link_rotations"
ON CONFLICT DO NOTHING;

-- Data migration: preset storefront_enabled (JSON boolean). false explícito no Starter: o sync só
-- faz upsert do que existe, então ausência não desligaria tenant rebaixado.
INSERT INTO "plan_entitlement_presets" ("id", "planSlug", "key", "value")
VALUES
  (gen_random_uuid()::text, 'COPYSYNC_STARTER', 'storefront_enabled', 'false'),
  (gen_random_uuid()::text, 'COPYSYNC_PROFISSIONAL', 'storefront_enabled', 'true'),
  (gen_random_uuid()::text, 'COPYSYNC_BUSINESS', 'storefront_enabled', 'true')
ON CONFLICT ("planSlug", "key") DO NOTHING;

-- Backfill para tenants com plano (o sync de entitlements só roda em webhook)
INSERT INTO "tenant_entitlements" ("id", "tenantId", "key", "value")
SELECT gen_random_uuid()::text, t."id", 'storefront_enabled', p."value"
FROM "tenants" t
JOIN "plan_entitlement_presets" p ON p."planSlug" = t."planSlug" AND p."key" = 'storefront_enabled'
ON CONFLICT ("tenantId", "key") DO NOTHING;
