-- CreateEnum
CREATE TYPE "OfferAudience" AS ENUM ('STANDARD', 'MOMS', 'PET', 'BEAUTY_FASHION', 'MEN', 'FITNESS', 'HOME_KITCHEN');

-- CreateEnum
CREATE TYPE "AiProviderKind" AS ENUM ('ANTHROPIC', 'OPENAI');

-- CreateEnum
CREATE TYPE "AiUsageSource" AS ENUM ('PLATFORM', 'TENANT');

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "declaredPhone" TEXT;

-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "audience" "OfferAudience" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "coupon" TEXT,
ADD COLUMN     "mentionAll" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "offer_generator_configs" (
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT,
    "intervalMinSeconds" INTEGER NOT NULL DEFAULT 8,
    "intervalMaxSeconds" INTEGER NOT NULL DEFAULT 15,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offer_generator_configs_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ai_platform_providers" (
    "id" TEXT NOT NULL,
    "kind" "AiProviderKind" NOT NULL,
    "label" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "apiKeyCiphertext" BYTEA NOT NULL,
    "apiKeyIv" BYTEA NOT NULL,
    "apiKeyTag" BYTEA NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "dailyLimitPerTenant" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_platform_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_ai_credentials" (
    "tenantId" TEXT NOT NULL,
    "kind" "AiProviderKind" NOT NULL,
    "model" TEXT NOT NULL,
    "apiKeyCiphertext" BYTEA NOT NULL,
    "apiKeyIv" BYTEA NOT NULL,
    "apiKeyTag" BYTEA NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_ai_credentials_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "ai_usage_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" "AiUsageSource" NOT NULL,
    "kind" "AiProviderKind" NOT NULL,
    "model" TEXT NOT NULL,
    "providerId" TEXT,
    "purpose" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_platform_providers_enabled_priority_idx" ON "ai_platform_providers"("enabled", "priority");

-- CreateIndex
CREATE INDEX "ai_usage_logs_tenantId_createdAt_idx" ON "ai_usage_logs"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "offer_generator_configs" ADD CONSTRAINT "offer_generator_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_generator_configs" ADD CONSTRAINT "offer_generator_configs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_ai_credentials" ADD CONSTRAINT "tenant_ai_credentials_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

