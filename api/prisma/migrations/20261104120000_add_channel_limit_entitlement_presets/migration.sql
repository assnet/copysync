-- Data migration: limites do plano por canal (docs/produto-roadmap.md, planPresets.ts).
-- Até aqui só existiam presets de rodízio, vitrine, story e extensão: sessões e grupos ficavam
-- ilimitados (entitlement ausente = ilimitado). WhatsApp: whatsapp_sessions, monitored_groups,
-- broadcast_groups. Telegram: telegram_sessions, telegram_monitored_groups, telegram_broadcast_groups.
-- DO NOTHING: não sobrescreve preset já ajustado à mão.
INSERT INTO "plan_entitlement_presets" ("id", "planSlug", "key", "value")
VALUES
  (gen_random_uuid()::text, 'COPYSYNC_LITE', 'whatsapp_sessions', '1'),
  (gen_random_uuid()::text, 'COPYSYNC_LITE', 'telegram_sessions', '0'),
  (gen_random_uuid()::text, 'COPYSYNC_LITE', 'monitored_groups', '1'),
  (gen_random_uuid()::text, 'COPYSYNC_LITE', 'broadcast_groups', '5'),
  (gen_random_uuid()::text, 'COPYSYNC_LITE', 'telegram_monitored_groups', '0'),
  (gen_random_uuid()::text, 'COPYSYNC_LITE', 'telegram_broadcast_groups', '0'),
  (gen_random_uuid()::text, 'COPYSYNC_LITE', 'mention_all_enabled', 'false'),
  (gen_random_uuid()::text, 'COPYSYNC_LITE', 'ai_rewrite_enabled', 'true'),
  (gen_random_uuid()::text, 'COPYSYNC_LITE', 'cross_session_dispatch', 'false'),
  (gen_random_uuid()::text, 'COPYSYNC_PRO', 'whatsapp_sessions', '1'),
  (gen_random_uuid()::text, 'COPYSYNC_PRO', 'telegram_sessions', '1'),
  (gen_random_uuid()::text, 'COPYSYNC_PRO', 'monitored_groups', '2'),
  (gen_random_uuid()::text, 'COPYSYNC_PRO', 'broadcast_groups', '10'),
  (gen_random_uuid()::text, 'COPYSYNC_PRO', 'telegram_monitored_groups', '2'),
  (gen_random_uuid()::text, 'COPYSYNC_PRO', 'telegram_broadcast_groups', '10'),
  (gen_random_uuid()::text, 'COPYSYNC_PRO', 'mention_all_enabled', 'true'),
  (gen_random_uuid()::text, 'COPYSYNC_PRO', 'ai_rewrite_enabled', 'true'),
  (gen_random_uuid()::text, 'COPYSYNC_PRO', 'cross_session_dispatch', 'false'),
  (gen_random_uuid()::text, 'COPYSYNC_MAX', 'whatsapp_sessions', '2'),
  (gen_random_uuid()::text, 'COPYSYNC_MAX', 'telegram_sessions', '2'),
  (gen_random_uuid()::text, 'COPYSYNC_MAX', 'monitored_groups', '6'),
  (gen_random_uuid()::text, 'COPYSYNC_MAX', 'broadcast_groups', '40'),
  (gen_random_uuid()::text, 'COPYSYNC_MAX', 'telegram_monitored_groups', '6'),
  (gen_random_uuid()::text, 'COPYSYNC_MAX', 'telegram_broadcast_groups', '40'),
  (gen_random_uuid()::text, 'COPYSYNC_MAX', 'mention_all_enabled', 'true'),
  (gen_random_uuid()::text, 'COPYSYNC_MAX', 'ai_rewrite_enabled', 'true'),
  (gen_random_uuid()::text, 'COPYSYNC_MAX', 'cross_session_dispatch', 'true')
ON CONFLICT ("planSlug", "key") DO NOTHING;

-- Backfill para tenants com plano (o sync de entitlements só roda em webhook do billing)
INSERT INTO "tenant_entitlements" ("id", "tenantId", "key", "value")
SELECT gen_random_uuid()::text, t."id", p."key", p."value"
FROM "tenants" t
JOIN "plan_entitlement_presets" p ON p."planSlug" = t."planSlug"
WHERE p."key" IN ('whatsapp_sessions', 'telegram_sessions', 'monitored_groups', 'broadcast_groups', 'telegram_monitored_groups', 'telegram_broadcast_groups', 'mention_all_enabled', 'ai_rewrite_enabled', 'cross_session_dispatch')
ON CONFLICT ("tenantId", "key") DO NOTHING;
