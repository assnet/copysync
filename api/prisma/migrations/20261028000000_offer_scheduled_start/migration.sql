-- Agendamento do início dos disparos de uma oferta (null = começa ao disparar)
ALTER TABLE "offers" ADD COLUMN "scheduledAt" TIMESTAMP(3);
