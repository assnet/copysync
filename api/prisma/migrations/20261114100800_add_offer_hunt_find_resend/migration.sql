-- Reenvio do achado pelo painel: contador e hora do último (trava de clique duplo por CAS em lastResentAt).
ALTER TABLE "offer_hunt_finds" ADD COLUMN "resendCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastResentAt" TIMESTAMP(3);
