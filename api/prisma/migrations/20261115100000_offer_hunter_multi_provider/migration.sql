-- Caçador multimarca (núcleo, `.specs/features/offer-hunter-multi/` T2). Aditiva: tudo que existe vira SHEIN.
-- Marca = enum `AffiliateProvider` (o mesmo da credencial, do aceite e do Resolve), sem enum novo.

-- Caçada: marca, filtros da fonte próprios da marca (ML: sort/extraEarningsOnly/bestSellersOnly) e registro da IA.
ALTER TABLE "offer_hunts" ADD COLUMN "provider" "AffiliateProvider" NOT NULL DEFAULT 'SHEIN',
ADD COLUMN "sourceOptions" JSONB,
ADD COLUMN "aiConfigured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "aiIntent" TEXT;

-- Execução: marca da caçada no momento da execução.
ALTER TABLE "offer_hunt_runs" ADD COLUMN "provider" "AffiliateProvider" NOT NULL DEFAULT 'SHEIN';

-- Achado: marca, id do produto na marca e comissão estimada. `productId` fica anulável (código antigo em voo no
-- deploy grava só `goodsId`; a leitura usa `COALESCE(productId, goodsId)`); `goodsId` passa a ser só da Shein.
ALTER TABLE "offer_hunt_finds" ADD COLUMN "provider" "AffiliateProvider" NOT NULL DEFAULT 'SHEIN',
ADD COLUMN "productId" TEXT,
ADD COLUMN "commissionEstimated" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "goodsId" DROP NOT NULL;

UPDATE "offer_hunt_finds" SET "productId" = "goodsId" WHERE "productId" IS NULL;

-- Repetição por marca + produto (troca o índice por goodsId).
DROP INDEX "offer_hunt_finds_huntId_goodsId_createdAt_idx";
CREATE INDEX "offer_hunt_finds_huntId_provider_productId_createdAt_idx" ON "offer_hunt_finds"("huntId", "provider", "productId", "createdAt");
