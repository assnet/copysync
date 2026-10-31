-- Renomeia os slugs de plano para LITE / PRO / MAX (nomes da vitrine).
-- Starter → LITE, Profissional → PRO, Business → MAX. O hub ainda não emite eventos da CopySync;
-- a partir daqui ele deve mandar os slugs novos. Texto livre (sem enum): só dados.
UPDATE "plan_entitlement_presets" SET "planSlug" = CASE "planSlug"
  WHEN 'COPYSYNC_STARTER' THEN 'COPYSYNC_LITE'
  WHEN 'COPYSYNC_PROFISSIONAL' THEN 'COPYSYNC_PRO'
  WHEN 'COPYSYNC_BUSINESS' THEN 'COPYSYNC_MAX'
END
WHERE "planSlug" IN ('COPYSYNC_STARTER', 'COPYSYNC_PROFISSIONAL', 'COPYSYNC_BUSINESS');

UPDATE "tenants" SET "planSlug" = CASE "planSlug"
  WHEN 'COPYSYNC_STARTER' THEN 'COPYSYNC_LITE'
  WHEN 'COPYSYNC_PROFISSIONAL' THEN 'COPYSYNC_PRO'
  WHEN 'COPYSYNC_BUSINESS' THEN 'COPYSYNC_MAX'
END
WHERE "planSlug" IN ('COPYSYNC_STARTER', 'COPYSYNC_PROFISSIONAL', 'COPYSYNC_BUSINESS');
