-- Data migration: Caçador de Ofertas (offer_hunter_enabled + offer_hunter_finds_per_day), preset só no MAX.
-- offer_hunter_enabled é "só true libera" (ausente = bloqueado); LITE e PRO ganham false explícito.
-- offer_hunter_finds_per_day: LITE 0, PRO 0, MAX 10 (ausente = 0 no caçador, nunca ilimitado).
-- As duas chaves são editáveis pelo super admin na rota admin: por isso todo INSERT usa
-- ON CONFLICT DO NOTHING (reexecução não desfaz a decisão dele) e não há UPDATE.
-- Tenants já sincronizados recebem as chaves aqui: o sync de entitlements só roda em webhook do billing.
INSERT INTO "plan_entitlement_presets" ("id", "planSlug", "key", "value")
VALUES
  (gen_random_uuid()::text, 'COPYSYNC_LITE', 'offer_hunter_enabled', 'false'),
  (gen_random_uuid()::text, 'COPYSYNC_PRO', 'offer_hunter_enabled', 'false'),
  (gen_random_uuid()::text, 'COPYSYNC_MAX', 'offer_hunter_enabled', 'true'),
  (gen_random_uuid()::text, 'COPYSYNC_LITE', 'offer_hunter_finds_per_day', '0'),
  (gen_random_uuid()::text, 'COPYSYNC_PRO', 'offer_hunter_finds_per_day', '0'),
  (gen_random_uuid()::text, 'COPYSYNC_MAX', 'offer_hunter_finds_per_day', '10')
ON CONFLICT ("planSlug", "key") DO NOTHING;

-- Valor do preset vigente do plano (não o literal): respeita alteração já feita pelo super admin
INSERT INTO "tenant_entitlements" ("id", "tenantId", "key", "value")
SELECT gen_random_uuid()::text, t."id", p."key", p."value"
FROM "tenants" t
JOIN "plan_entitlement_presets" p ON p."planSlug" = t."planSlug"
  AND p."key" IN ('offer_hunter_enabled', 'offer_hunter_finds_per_day')
ON CONFLICT ("tenantId", "key") DO NOTHING;
