-- CreateEnum
CREATE TYPE "AffiliateProvider" AS ENUM ('SHOPEE', 'MERCADO_LIVRE', 'AMAZON');

-- CreateEnum
CREATE TYPE "AffiliateCredentialStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'AFFILIATE_CREDENTIAL_UPSERTED';
ALTER TYPE "AuditAction" ADD VALUE 'AFFILIATE_CREDENTIAL_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'AFFILIATE_SESSION_SYNCED';

-- CreateTable
CREATE TABLE "affiliate_credentials" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "AffiliateProvider" NOT NULL,
    "publicIdentifier" TEXT,
    "secretCiphertext" BYTEA,
    "secretIv" BYTEA,
    "secretTag" BYTEA,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "AffiliateCredentialStatus" NOT NULL DEFAULT 'ACTIVE',
    "sessionCiphertext" BYTEA,
    "sessionIv" BYTEA,
    "sessionTag" BYTEA,
    "sessionKeyVersion" INTEGER,
    "sessionSyncedAt" TIMESTAMP(3),
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_credentials_tenantId_provider_key" ON "affiliate_credentials"("tenantId", "provider");

-- AddForeignKey
ALTER TABLE "affiliate_credentials" ADD CONSTRAINT "affiliate_credentials_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
