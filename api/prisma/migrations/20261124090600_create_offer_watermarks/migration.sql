-- Marca d'água própria das ofertas (só MAX, `offer_watermark_enabled`): um registro por tenant.
-- `kind` escolhe UMA fonte (logo OU texto); trocar o tipo preserva o outro dado. Opacidade 20–100 validada no domínio.
-- CreateEnum
CREATE TYPE "OfferWatermarkKind" AS ENUM ('IMAGE', 'TEXT');

-- CreateEnum
CREATE TYPE "OfferWatermarkPosition" AS ENUM ('TOP_LEFT', 'TOP_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_RIGHT', 'CENTER');

-- CreateEnum
CREATE TYPE "OfferWatermarkSize" AS ENUM ('SMALL', 'MEDIUM', 'LARGE');

-- CreateTable
CREATE TABLE "offer_watermarks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "OfferWatermarkKind" NOT NULL DEFAULT 'IMAGE',
    "imageKey" TEXT,
    "text" VARCHAR(32),
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "position" "OfferWatermarkPosition" NOT NULL DEFAULT 'BOTTOM_RIGHT',
    "size" "OfferWatermarkSize" NOT NULL DEFAULT 'MEDIUM',
    "opacity" INTEGER NOT NULL DEFAULT 80,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offer_watermarks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "offer_watermarks_tenantId_key" ON "offer_watermarks"("tenantId");

-- AddForeignKey
ALTER TABLE "offer_watermarks" ADD CONSTRAINT "offer_watermarks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

