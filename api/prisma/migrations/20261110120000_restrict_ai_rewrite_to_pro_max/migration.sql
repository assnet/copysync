-- Data migration: "Reescrita com IA" (ai_rewrite_enabled) só no PRO e no MAX (decisão do dono, 2026-11-10).
-- O LITE passa a false explícito: a chave é "só false bloqueia" (ausente = liberado), então o sync de
-- entitlements só desliga quem tiver o false gravado. Vale no gerador e no monitoramento
-- (OfferTextComposer); configuração salva com IA no LITE cai no Modelo, sem reescrever linha.
UPDATE "plan_entitlement_presets" SET "value" = 'false'
WHERE "planSlug" = 'COPYSYNC_LITE' AND "key" = 'ai_rewrite_enabled';

INSERT INTO "plan_entitlement_presets" ("id", "planSlug", "key", "value")
VALUES (gen_random_uuid()::text, 'COPYSYNC_LITE', 'ai_rewrite_enabled', 'false')
ON CONFLICT ("planSlug", "key") DO NOTHING;

-- Tenants LITE já sincronizados: o sync só roda em webhook do billing
UPDATE "tenant_entitlements" e SET "value" = 'false'
FROM "tenants" t
WHERE e."tenantId" = t."id" AND t."planSlug" = 'COPYSYNC_LITE' AND e."key" = 'ai_rewrite_enabled';

INSERT INTO "tenant_entitlements" ("id", "tenantId", "key", "value")
SELECT gen_random_uuid()::text, t."id", 'ai_rewrite_enabled', 'false'
FROM "tenants" t
WHERE t."planSlug" = 'COPYSYNC_LITE'
ON CONFLICT ("tenantId", "key") DO NOTHING;
