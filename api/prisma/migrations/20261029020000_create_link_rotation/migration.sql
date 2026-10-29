-- Rodízio de links (link rotation): domínios curtos da plataforma (link_domains, sem tenantId),
-- rotações por tenant com slug único por domínio (link_rotations), grupos de cada rotação com
-- convite, capacidade e contadores (link_rotation_groups), reserva de slug por 30 dias após
-- troca/exclusão (link_slug_reservations) e registro de cliques para estatística de 7 dias e
-- dedupe (link_clicks, retenção 90 dias pelo job). Sessão dona da rotação: ON DELETE RESTRICT.
-- No fim, presets de plano link_rotations / link_rotation_groups (não sobrescreve existentes).

-- CreateEnum
CREATE TYPE "LinkDomainStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "LinkRotationStatus" AS ENUM ('ACTIVE', 'PAUSED', 'PAUSED_BY_PLAN');

-- CreateEnum
CREATE TYPE "LinkRotationStrategy" AS ENUM ('BALANCED', 'SEQUENTIAL', 'WEIGHTED', 'RANDOM');

-- CreateEnum
CREATE TYPE "LinkRotationGroupStatus" AS ENUM ('ACTIVE', 'PAUSED', 'FULL', 'NEEDS_LINK', 'PAUSED_BY_PLAN');

-- CreateEnum
CREATE TYPE "LinkRotationGroupLinkSource" AS ENUM ('AUTO', 'MANUAL');

-- CreateTable
CREATE TABLE "link_domains" (
    "id" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "status" "LinkDomainStatus" NOT NULL DEFAULT 'ACTIVE',
    "landingUrl" TEXT,
    "reservedNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastProbeAt" TIMESTAMP(3),
    "lastProbeOk" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "link_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_rotations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "LinkRotationStatus" NOT NULL DEFAULT 'ACTIVE',
    "strategy" "LinkRotationStrategy" NOT NULL DEFAULT 'BALANCED',
    "title" TEXT,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "lastClickAt" TIMESTAMP(3),
    "allFullNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "link_rotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_rotation_groups" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rotationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "groupJid" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "capacity" INTEGER NOT NULL DEFAULT 1000,
    "inviteCode" TEXT,
    "linkSource" "LinkRotationGroupLinkSource",
    "status" "LinkRotationGroupStatus" NOT NULL DEFAULT 'ACTIVE',
    "memberCount" INTEGER,
    "memberCountAt" TIMESTAMP(3),
    "clicksSinceSync" INTEGER NOT NULL DEFAULT 0,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "lastClickAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "link_rotation_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_slug_reservations" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "link_slug_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_clicks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rotationId" TEXT NOT NULL,
    "groupId" TEXT,
    "ipHash" TEXT NOT NULL,
    "userAgentClass" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "link_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "link_domains_hostname_key" ON "link_domains"("hostname");

-- CreateIndex
CREATE INDEX "link_rotations_tenantId_idx" ON "link_rotations"("tenantId");

-- CreateIndex
CREATE INDEX "link_rotations_sessionId_idx" ON "link_rotations"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "link_rotations_domainId_slug_key" ON "link_rotations"("domainId", "slug");

-- CreateIndex
CREATE INDEX "link_rotation_groups_tenantId_idx" ON "link_rotation_groups"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "link_rotation_groups_rotationId_conversationId_key" ON "link_rotation_groups"("rotationId", "conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "link_slug_reservations_domainId_slug_key" ON "link_slug_reservations"("domainId", "slug");

-- CreateIndex
CREATE INDEX "link_clicks_rotationId_createdAt_idx" ON "link_clicks"("rotationId", "createdAt");

-- AddForeignKey
ALTER TABLE "link_rotations" ADD CONSTRAINT "link_rotations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_rotations" ADD CONSTRAINT "link_rotations_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_rotations" ADD CONSTRAINT "link_rotations_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "link_domains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_rotation_groups" ADD CONSTRAINT "link_rotation_groups_rotationId_fkey" FOREIGN KEY ("rotationId") REFERENCES "link_rotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_rotation_groups" ADD CONSTRAINT "link_rotation_groups_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_rotation_groups" ADD CONSTRAINT "link_rotation_groups_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_slug_reservations" ADD CONSTRAINT "link_slug_reservations_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "link_domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_slug_reservations" ADD CONSTRAINT "link_slug_reservations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_clicks" ADD CONSTRAINT "link_clicks_rotationId_fkey" FOREIGN KEY ("rotationId") REFERENCES "link_rotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_clicks" ADD CONSTRAINT "link_clicks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_clicks" ADD CONSTRAINT "link_clicks_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "link_rotation_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Data migration: presets de plano do rodízio de links
INSERT INTO "plan_entitlement_presets" ("id", "planSlug", "key", "value")
VALUES
  (gen_random_uuid()::text, 'COPYSYNC_STARTER', 'link_rotations', '1'),
  (gen_random_uuid()::text, 'COPYSYNC_STARTER', 'link_rotation_groups', '3'),
  (gen_random_uuid()::text, 'COPYSYNC_PROFISSIONAL', 'link_rotations', '1'),
  (gen_random_uuid()::text, 'COPYSYNC_PROFISSIONAL', 'link_rotation_groups', '5'),
  (gen_random_uuid()::text, 'COPYSYNC_BUSINESS', 'link_rotations', '2'),
  (gen_random_uuid()::text, 'COPYSYNC_BUSINESS', 'link_rotation_groups', '10')
ON CONFLICT ("planSlug", "key") DO NOTHING;
