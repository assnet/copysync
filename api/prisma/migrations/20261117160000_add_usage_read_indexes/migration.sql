-- Uso dos recursos (métricas de uso, design §4.1 e D6): leitura por período sem `tenantId`.
-- Os índices atuais começam por `tenantId` e não servem filtro só por data. Aditiva; `IF NOT EXISTS`
-- para virar no-op quando o índice já foi criado antes do deploy com `CREATE INDEX CONCURRENTLY`.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "offers_createdAt_idx" ON "offers"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "offer_dispatches_status_updatedAt_idx" ON "offer_dispatches"("status", "updatedAt");
