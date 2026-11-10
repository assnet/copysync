-- Padrões novos do monitoramento e da oferta (docs/monitoramento-grupos.md). Só o DEFAULT muda:
-- configurações já salvas ficam como estão. MEDIA salvo sai como LINK_PREVIEW no envio
-- (`effectiveImageMode`), sem reescrever linha.
ALTER TABLE "offers" ALTER COLUMN "imageMode" SET DEFAULT 'LINK_PREVIEW';

ALTER TABLE "group_monitor_configs"
  ALTER COLUMN "intervalMinSeconds" SET DEFAULT 0,
  ALTER COLUMN "intervalMaxSeconds" SET DEFAULT 0,
  ALTER COLUMN "maxOfferAgeMinutes" SET DEFAULT 1440,
  ALTER COLUMN "couponMaxAgeMinutes" SET DEFAULT 1440,
  ALTER COLUMN "simulateTyping" SET DEFAULT true,
  ALTER COLUMN "typingSeconds" SET DEFAULT 3,
  ALTER COLUMN "enrichLinkOnly" SET DEFAULT false,
  ALTER COLUMN "imageMode" SET DEFAULT 'LINK_PREVIEW';

-- Data migration: "Montar a oferta quando chegar só o link" só no Pro e no Max;
-- "Capturar fora do horário" (capture_outside_window_enabled) só no Max.
-- false explícito no Lite: o sync só faz upsert do que existe. DO NOTHING: não sobrescreve ajuste manual.
INSERT INTO "plan_entitlement_presets" ("id", "planSlug", "key", "value")
VALUES
  (gen_random_uuid()::text, 'COPYSYNC_LITE', 'enrich_link_only_enabled', 'false'),
  (gen_random_uuid()::text, 'COPYSYNC_PRO', 'enrich_link_only_enabled', 'true'),
  (gen_random_uuid()::text, 'COPYSYNC_MAX', 'enrich_link_only_enabled', 'true'),
  (gen_random_uuid()::text, 'COPYSYNC_LITE', 'capture_outside_window_enabled', 'false'),
  (gen_random_uuid()::text, 'COPYSYNC_PRO', 'capture_outside_window_enabled', 'false'),
  (gen_random_uuid()::text, 'COPYSYNC_MAX', 'capture_outside_window_enabled', 'true')
ON CONFLICT ("planSlug", "key") DO NOTHING;

-- Backfill para tenants com plano (o sync de entitlements só roda em webhook do billing)
INSERT INTO "tenant_entitlements" ("id", "tenantId", "key", "value")
SELECT gen_random_uuid()::text, t."id", p."key", p."value"
FROM "tenants" t
JOIN "plan_entitlement_presets" p ON p."planSlug" = t."planSlug"
WHERE p."key" IN ('enrich_link_only_enabled', 'capture_outside_window_enabled')
ON CONFLICT ("tenantId", "key") DO NOTHING;
