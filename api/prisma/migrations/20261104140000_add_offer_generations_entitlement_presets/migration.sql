-- Data migration: limite diário do gerador de ofertas (docs/gerador-de-ofertas.md, planPresets.ts).
-- offer_generations_per_day: LITE 5, PRO 20, MAX JSON null (= ilimitado, explícito para o
-- upgrade sobrescrever o limite gravado). DO NOTHING: não sobrescreve preset ajustado à mão.
INSERT INTO "plan_entitlement_presets" ("id", "planSlug", "key", "value")
VALUES
  (gen_random_uuid()::text, 'COPYSYNC_LITE', 'offer_generations_per_day', '5'),
  (gen_random_uuid()::text, 'COPYSYNC_PRO', 'offer_generations_per_day', '20'),
  (gen_random_uuid()::text, 'COPYSYNC_MAX', 'offer_generations_per_day', 'null')
ON CONFLICT ("planSlug", "key") DO NOTHING;

-- Backfill para tenants com plano (o sync de entitlements só roda em webhook do billing)
INSERT INTO "tenant_entitlements" ("id", "tenantId", "key", "value")
SELECT gen_random_uuid()::text, t."id", p."key", p."value"
FROM "tenants" t
JOIN "plan_entitlement_presets" p ON p."planSlug" = t."planSlug"
WHERE p."key" = 'offer_generations_per_day'
ON CONFLICT ("tenantId", "key") DO NOTHING;
