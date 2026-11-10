-- Aceites do aviso de risco por tenant (só inclusão). Depende do valor SHEIN criado em 20261111090000.
CREATE TABLE "marketplace_risk_acceptances" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "AffiliateProvider" NOT NULL,
    "noticeVersion" TEXT NOT NULL,
    "acceptedByUserId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_risk_acceptances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marketplace_risk_acceptances_tenantId_provider_noticeVersio_key" ON "marketplace_risk_acceptances"("tenantId", "provider", "noticeVersion");
CREATE INDEX "marketplace_risk_acceptances_tenantId_provider_idx" ON "marketplace_risk_acceptances"("tenantId", "provider");
CREATE INDEX "marketplace_risk_acceptances_acceptedByUserId_idx" ON "marketplace_risk_acceptances"("acceptedByUserId");

ALTER TABLE "marketplace_risk_acceptances" ADD CONSTRAINT "marketplace_risk_acceptances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketplace_risk_acceptances" ADD CONSTRAINT "marketplace_risk_acceptances_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
