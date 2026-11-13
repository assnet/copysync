-- Ranking da execução (até 15 itens, só exibição; sem link/token); null = execução antiga.
ALTER TABLE "offer_hunt_runs" ADD COLUMN "ranking" JSONB;
