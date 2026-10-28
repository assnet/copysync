-- Monitoramento: oferta montada (dados do produto) e reescrita com IA. Padrão ORIGINAL mantém o comportamento atual;
-- enrichLinkOnly=true faz captura só com link virar oferta montada.

-- CreateEnum
CREATE TYPE "MonitorTextMode" AS ENUM ('ORIGINAL', 'TEMPLATE', 'AI');

-- AlterTable
ALTER TABLE "group_monitor_configs"
  ADD COLUMN "textMode" "MonitorTextMode" NOT NULL DEFAULT 'ORIGINAL',
  ADD COLUMN "audience" "OfferAudience" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "enrichLinkOnly" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "captured_offers"
  ADD COLUMN "textSource" "MonitorTextMode",
  ADD COLUMN "aiErrorCode" TEXT;
