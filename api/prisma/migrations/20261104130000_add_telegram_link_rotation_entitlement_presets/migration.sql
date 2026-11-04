-- Data migration: limites do rodízio de links por canal (docs/rodizio-de-links.md, planPresets.ts).
-- link_rotations / link_rotation_groups passam a valer só para o WhatsApp (já existem desde
-- 20261029020000; repetidos aqui por garantia). Telegram ganha chaves próprias:
-- telegram_link_rotations / telegram_link_rotation_groups (LITE 0/0, PRO 1/5, MAX 2/10).
-- DO NOTHING: não sobrescreve preset já ajustado à mão.
INSERT INTO "plan_entitlement_presets" ("id", "planSlug", "key", "value")
VALUES
  (gen_random_uuid()::text, 'COPYSYNC_LITE', 'link_rotations', '1'),
  (gen_random_uuid()::text, 'COPYSYNC_LITE', 'link_rotation_groups', '3'),
  (gen_random_uuid()::text, 'COPYSYNC_LITE', 'telegram_link_rotations', '0'),
  (gen_random_uuid()::text, 'COPYSYNC_LITE', 'telegram_link_rotation_groups', '0'),
  (gen_random_uuid()::text, 'COPYSYNC_PRO', 'link_rotations', '1'),
  (gen_random_uuid()::text, 'COPYSYNC_PRO', 'link_rotation_groups', '5'),
  (gen_random_uuid()::text, 'COPYSYNC_PRO', 'telegram_link_rotations', '1'),
  (gen_random_uuid()::text, 'COPYSYNC_PRO', 'telegram_link_rotation_groups', '5'),
  (gen_random_uuid()::text, 'COPYSYNC_MAX', 'link_rotations', '2'),
  (gen_random_uuid()::text, 'COPYSYNC_MAX', 'link_rotation_groups', '10'),
  (gen_random_uuid()::text, 'COPYSYNC_MAX', 'telegram_link_rotations', '2'),
  (gen_random_uuid()::text, 'COPYSYNC_MAX', 'telegram_link_rotation_groups', '10')
ON CONFLICT ("planSlug", "key") DO NOTHING;

-- Backfill para tenants com plano (o sync de entitlements só roda em webhook do billing)
INSERT INTO "tenant_entitlements" ("id", "tenantId", "key", "value")
SELECT gen_random_uuid()::text, t."id", p."key", p."value"
FROM "tenants" t
JOIN "plan_entitlement_presets" p ON p."planSlug" = t."planSlug"
WHERE p."key" IN ('link_rotations', 'link_rotation_groups', 'telegram_link_rotations', 'telegram_link_rotation_groups')
ON CONFLICT ("tenantId", "key") DO NOTHING;
