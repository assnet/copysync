-- Consentimento da extensão para sincronizar a sessão da Shein (nulo = sem consentimento).
ALTER TABLE "extension_sessions" ADD COLUMN "sheinConsentAt" TIMESTAMP(3);
