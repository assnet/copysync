-- Índice por conta em feature_usage_daily: o ON DELETE CASCADE da conta e a leitura por conta não varrem a tabela.
CREATE INDEX "feature_usage_daily_tenantId_idx" ON "feature_usage_daily"("tenantId");
