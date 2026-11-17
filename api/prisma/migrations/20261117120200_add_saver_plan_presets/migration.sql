-- Data migration: presets dos planos Saver (espelho de SAVER_PLAN_PRESETS em tenants/domain/planPresets.ts).
-- No Saver chave ausente = 0; ilimitado só com JSON null explícito (SAVER_MAX em saver_groups e saver_contacts).
-- ON CONFLICT DO NOTHING: reexecução não desfaz ajuste feito pelo super admin. Nenhum tenant tem plano Saver
-- ainda (acesso por produto em tenant_products), então não há cópia para tenant_entitlements.
INSERT INTO "plan_entitlement_presets" ("id", "planSlug", "key", "value")
VALUES
  (gen_random_uuid()::text, 'SAVER_LITE', 'whatsapp_sessions', '1'),
  (gen_random_uuid()::text, 'SAVER_LITE', 'telegram_sessions', '0'),
  (gen_random_uuid()::text, 'SAVER_LITE', 'saver_groups', '10'),
  (gen_random_uuid()::text, 'SAVER_LITE', 'saver_contacts', '10000'),
  (gen_random_uuid()::text, 'SAVER_LITE', 'saver_group_scans_per_day', '20'),
  (gen_random_uuid()::text, 'SAVER_LITE', 'saver_auto_refresh_enabled', 'false'),
  (gen_random_uuid()::text, 'SAVER_PRO', 'whatsapp_sessions', '1'),
  (gen_random_uuid()::text, 'SAVER_PRO', 'telegram_sessions', '0'),
  (gen_random_uuid()::text, 'SAVER_PRO', 'saver_groups', '50'),
  (gen_random_uuid()::text, 'SAVER_PRO', 'saver_contacts', '50000'),
  (gen_random_uuid()::text, 'SAVER_PRO', 'saver_group_scans_per_day', '100'),
  (gen_random_uuid()::text, 'SAVER_PRO', 'saver_auto_refresh_enabled', 'true'),
  (gen_random_uuid()::text, 'SAVER_MAX', 'whatsapp_sessions', '2'),
  (gen_random_uuid()::text, 'SAVER_MAX', 'telegram_sessions', '0'),
  (gen_random_uuid()::text, 'SAVER_MAX', 'saver_groups', 'null'),
  (gen_random_uuid()::text, 'SAVER_MAX', 'saver_contacts', 'null'),
  (gen_random_uuid()::text, 'SAVER_MAX', 'saver_group_scans_per_day', '500'),
  (gen_random_uuid()::text, 'SAVER_MAX', 'saver_auto_refresh_enabled', 'true')
ON CONFLICT ("planSlug", "key") DO NOTHING;
