-- MQ-21: CPU e event loop no batimento. Colunas NULLABLE: imagem antiga segue gravando sem elas
-- durante o deploy sobreposto. Aditiva, sem backfill.
ALTER TABLE "worker_heartbeats" ADD COLUMN "cpuPct" DOUBLE PRECISION,
ADD COLUMN "eventLoopP99Ms" DOUBLE PRECISION;
