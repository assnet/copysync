-- Escopo do aceite do aviso de risco: AFFILIATE_LINK (aviso do marketplace, padrão) ou OFFER_HUNTER
-- (caçador de ofertas). Linhas existentes ficam AFFILIATE_LINK. Tabela segue só inclusão.
CREATE TYPE "MarketplaceRiskScope" AS ENUM ('AFFILIATE_LINK', 'OFFER_HUNTER');

ALTER TABLE "marketplace_risk_acceptances" ADD COLUMN "scope" "MarketplaceRiskScope" NOT NULL DEFAULT 'AFFILIATE_LINK';

-- Único passa a ser por (tenant, provider, escopo, versão).
DROP INDEX "marketplace_risk_acceptances_tenantId_provider_noticeVersio_key";

CREATE UNIQUE INDEX "marketplace_risk_acceptances_tenantId_provider_scope_notice_key" ON "marketplace_risk_acceptances"("tenantId", "provider", "scope", "noticeVersion");
