-- Data migration: preset offer_story_enabled (JSON boolean), Story de Oferta só no Business.
-- false explícito no Starter e no Profissional: o sync só faz upsert do que existe, então ausência
-- não desligaria tenant rebaixado.
INSERT INTO "plan_entitlement_presets" ("id", "planSlug", "key", "value")
VALUES
  (gen_random_uuid()::text, 'COPYSYNC_STARTER', 'offer_story_enabled', 'false'),
  (gen_random_uuid()::text, 'COPYSYNC_PROFISSIONAL', 'offer_story_enabled', 'false'),
  (gen_random_uuid()::text, 'COPYSYNC_BUSINESS', 'offer_story_enabled', 'true')
ON CONFLICT ("planSlug", "key") DO NOTHING;

-- Backfill para tenants com plano (o sync de entitlements só roda em webhook)
INSERT INTO "tenant_entitlements" ("id", "tenantId", "key", "value")
SELECT gen_random_uuid()::text, t."id", 'offer_story_enabled', p."value"
FROM "tenants" t
JOIN "plan_entitlement_presets" p ON p."planSlug" = t."planSlug" AND p."key" = 'offer_story_enabled'
ON CONFLICT ("tenantId", "key") DO NOTHING;
