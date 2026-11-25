-- Data migration: Kabum, Magalu e AliExpress como marketplaces, preset só no MAX (mesma forma da Shein).
-- Chaves "só true libera" (ausente = bloqueado); LITE e PRO ganham false explícito.
-- O super admin pode liberar a chave para outro plano pela rota admin: por isso todo INSERT usa
-- ON CONFLICT DO NOTHING (reexecução não desfaz a decisão dele) e não há UPDATE.
-- Tenants já sincronizados recebem as chaves aqui: o sync de entitlements só roda em webhook do billing.
INSERT INTO "plan_entitlement_presets" ("id", "planSlug", "key", "value")
VALUES
  (gen_random_uuid()::text, 'COPYSYNC_LITE', 'marketplace_kabum_enabled', 'false'),
  (gen_random_uuid()::text, 'COPYSYNC_PRO', 'marketplace_kabum_enabled', 'false'),
  (gen_random_uuid()::text, 'COPYSYNC_MAX', 'marketplace_kabum_enabled', 'true'),
  (gen_random_uuid()::text, 'COPYSYNC_LITE', 'marketplace_magalu_enabled', 'false'),
  (gen_random_uuid()::text, 'COPYSYNC_PRO', 'marketplace_magalu_enabled', 'false'),
  (gen_random_uuid()::text, 'COPYSYNC_MAX', 'marketplace_magalu_enabled', 'true'),
  (gen_random_uuid()::text, 'COPYSYNC_LITE', 'marketplace_aliexpress_enabled', 'false'),
  (gen_random_uuid()::text, 'COPYSYNC_PRO', 'marketplace_aliexpress_enabled', 'false'),
  (gen_random_uuid()::text, 'COPYSYNC_MAX', 'marketplace_aliexpress_enabled', 'true')
ON CONFLICT ("planSlug", "key") DO NOTHING;

-- Valor do preset vigente do plano (não o literal): respeita liberação já feita pelo super admin
INSERT INTO "tenant_entitlements" ("id", "tenantId", "key", "value")
SELECT gen_random_uuid()::text, t."id", p."key", p."value"
FROM "tenants" t
JOIN "plan_entitlement_presets" p ON p."planSlug" = t."planSlug"
  AND p."key" IN ('marketplace_kabum_enabled', 'marketplace_magalu_enabled', 'marketplace_aliexpress_enabled')
ON CONFLICT ("tenantId", "key") DO NOTHING;
