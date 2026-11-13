-- Quantos candidatos cada filtro local barrou na execução (+ `repeated`); null = execução antiga.
ALTER TABLE "offer_hunt_runs" ADD COLUMN "rejectedBy" JSONB;
