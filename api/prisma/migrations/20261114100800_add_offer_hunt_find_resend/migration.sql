-- Reenvio do achado pelo painel. `resendCount` sobe no claim (número do reenvio: sourceKey `hunt:<id>:r<n>`),
-- `resendInFlightUntil` marca o reenvio em voo (2º clique recusado; vencido = mesmo reenvio retomado com o mesmo n).
ALTER TABLE "offer_hunt_finds" ADD COLUMN "resendCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastResentAt" TIMESTAMP(3),
ADD COLUMN "resendInFlightUntil" TIMESTAMP(3);

-- Teto diário de reenvios por tenant (contador do dia, serializado por lock do tenant no claim).
ALTER TABLE "offer_hunter_settings" ADD COLUMN "resendDayStart" TIMESTAMP(3),
ADD COLUMN "resendsInDay" INTEGER NOT NULL DEFAULT 0;
