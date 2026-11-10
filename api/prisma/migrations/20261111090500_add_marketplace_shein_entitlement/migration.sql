-- Data migration: Shein como marketplace (marketplace_shein_enabled), preset só no MAX.
-- A chave é "só true libera" (ausente = bloqueado); LITE e PRO ganham false explícito.
-- O super admin pode liberar a chave para outro plano pela rota admin: por isso todo INSERT usa
-- ON CONFLICT DO NOTHING (reexecução não desfaz a decisão dele) e não há UPDATE.
-- Tenants já sincronizados recebem a chave aqui: o sync de entitlements só roda em webhook do billing.
INSERT INTO "plan_entitlement_presets" ("id", "planSlug", "key", "value")
VALUES
  (gen_random_uuid()::text, 'COPYSYNC_LITE', 'marketplace_shein_enabled', 'false'),
  (gen_random_uuid()::text, 'COPYSYNC_PRO', 'marketplace_shein_enabled', 'false'),
  (gen_random_uuid()::text, 'COPYSYNC_MAX', 'marketplace_shein_enabled', 'true')
ON CONFLICT ("planSlug", "key") DO NOTHING;

-- Valor do preset vigente do plano (não o literal): respeita liberação já feita pelo super admin
INSERT INTO "tenant_entitlements" ("id", "tenantId", "key", "value")
SELECT gen_random_uuid()::text, t."id", p."key", p."value"
FROM "tenants" t
JOIN "plan_entitlement_presets" p ON p."planSlug" = t."planSlug" AND p."key" = 'marketplace_shein_enabled'
ON CONFLICT ("tenantId", "key") DO NOTHING;
