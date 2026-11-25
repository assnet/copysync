-- Foto limpa: troca a foto capturada pela oficial do produto (PRO/MAX, `offer_clean_image_enabled`).
-- Desligada por padrão: configurações existentes seguem com a foto capturada.
ALTER TABLE "group_monitor_configs" ADD COLUMN "useProductImage" BOOLEAN NOT NULL DEFAULT false;
