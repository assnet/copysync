-- Sugestões de configuração pela IA no assistente do caçador (teto técnico por tenant/dia). Só a contagem:
-- sem intenção, prompt nem resposta. Aditiva.
CREATE TABLE "offer_hunt_ai_suggestions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_hunt_ai_suggestions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "offer_hunt_ai_suggestions_tenantId_createdAt_idx" ON "offer_hunt_ai_suggestions"("tenantId", "createdAt");

ALTER TABLE "offer_hunt_ai_suggestions" ADD CONSTRAINT "offer_hunt_ai_suggestions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
