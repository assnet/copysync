-- Data migration: foto oficial no lugar da foto do grupo (PRO e MAX) e marca d'água própria (só MAX).
-- Chaves "só true libera" (ausente = bloqueado); planos sem o recurso ganham false explícito.
-- O super admin pode liberar a chave para outro plano pela rota admin: por isso todo INSERT usa
-- ON CONFLICT DO NOTHING (reexecução não desfaz a decisão dele) e não há UPDATE.
-- Tenants já sincronizados recebem as chaves aqui: o sync de entitlements só roda em webhook do billing.
INSERT INTO "plan_entitlement_presets" ("id", "planSlug", "key", "value")
VALUES
  (gen_random_uuid()::text, 'COPYSYNC_LITE', 'offer_clean_image_enabled', 'false'),
  (gen_random_uuid()::text, 'COPYSYNC_PRO', 'offer_clean_image_enabled', 'true'),
  (gen_random_uuid()::text, 'COPYSYNC_MAX', 'offer_clean_image_enabled', 'true'),
  (gen_random_uuid()::text, 'COPYSYNC_LITE', 'offer_watermark_enabled', 'false'),
  (gen_random_uuid()::text, 'COPYSYNC_PRO', 'offer_watermark_enabled', 'false'),
  (gen_random_uuid()::text, 'COPYSYNC_MAX', 'offer_watermark_enabled', 'true')
ON CONFLICT ("planSlug", "key") DO NOTHING;

-- Valor do preset vigente do plano (não o literal): respeita liberação já feita pelo super admin
INSERT INTO "tenant_entitlements" ("id", "tenantId", "key", "value")
SELECT gen_random_uuid()::text, t."id", p."key", p."value"
FROM "tenants" t
JOIN "plan_entitlement_presets" p ON p."planSlug" = t."planSlug"
  AND p."key" IN ('offer_clean_image_enabled', 'offer_watermark_enabled')
ON CONFLICT ("tenantId", "key") DO NOTHING;
