-- MQ-23: índice só em "at" para a retenção do OpsMetricsSamplerJob (DELETE WHERE at < now() - 7d).
-- O índice ("metric", "at") não serve a esse delete: "metric" não está no filtro.
CREATE INDEX "ops_metrics_samples_at_idx" ON "ops_metrics_samples"("at");
