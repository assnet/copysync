-- Ordem de envio dos grupos do gerador de ofertas (dentro de cada sessão). Linhas antigas ganham a
-- ordem em que foram gravadas (createdAt, desempate pelo id da conversa).
ALTER TABLE "offer_destinations" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

UPDATE "offer_destinations" AS d
SET "position" = r.rn - 1
FROM (
  SELECT "tenantId", "conversationId",
         ROW_NUMBER() OVER (PARTITION BY "tenantId" ORDER BY "createdAt", "conversationId") AS rn
  FROM "offer_destinations"
) AS r
WHERE d."tenantId" = r."tenantId" AND d."conversationId" = r."conversationId";
