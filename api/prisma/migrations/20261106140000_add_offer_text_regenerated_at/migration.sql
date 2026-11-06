-- "Gerar novamente" vale uma vez por oferta: data do uso; null = disponível (ofertas antigas ganham o uso).
ALTER TABLE "offers" ADD COLUMN "textRegeneratedAt" TIMESTAMP(3);
