import { describe, expect, it } from 'vitest';
import { PLAN_PRESETS, planPresetRows } from './planPresets';
import { ENTITLEMENT_KEYS as K } from './entitlementKeys';

/** Mesmos números da vitrine (`app/src/features/plans/catalog.ts` → `limits`) e do roadmap. Mudou lá, muda aqui. */
const CATALOG_LIMITS = {
  COPYSYNC_STARTER: { whatsappSessions: 1, monitoredGroups: 1, broadcastGroups: 5, mentionAll: false, crossSession: false, linkRotations: 1, linkRotationGroups: 3 },
  COPYSYNC_PROFISSIONAL: { whatsappSessions: 1, monitoredGroups: 2, broadcastGroups: 10, mentionAll: true, crossSession: false, linkRotations: 1, linkRotationGroups: 5 },
  COPYSYNC_BUSINESS: { whatsappSessions: 2, monitoredGroups: 6, broadcastGroups: 40, mentionAll: true, crossSession: true, linkRotations: 2, linkRotationGroups: 10 },
} as const;

describe('PLAN_PRESETS', () => {
  it.each(Object.keys(CATALOG_LIMITS) as (keyof typeof CATALOG_LIMITS)[])('%s bate com a vitrine', (slug) => {
    const c = CATALOG_LIMITS[slug];
    expect(PLAN_PRESETS[slug]).toMatchObject({
      [K.WHATSAPP_SESSIONS]: c.whatsappSessions,
      [K.MONITORED_GROUPS]: c.monitoredGroups,
      [K.BROADCAST_GROUPS]: c.broadcastGroups,
      [K.MENTION_ALL_ENABLED]: c.mentionAll,
      [K.CROSS_SESSION_DISPATCH]: c.crossSession,
      [K.LINK_ROTATIONS]: c.linkRotations,
      [K.LINK_ROTATION_GROUPS]: c.linkRotationGroups,
    });
  });

  it('sessão cruzada só no Business; linhas do seed cobrem todos os planos', () => {
    const rows = planPresetRows();
    const cross = rows.filter((r) => r.key === K.CROSS_SESSION_DISPATCH && r.value === true).map((r) => r.planSlug);
    expect(cross).toEqual(['COPYSYNC_BUSINESS']);
    expect(new Set(rows.map((r) => r.planSlug)).size).toBe(3);
  });
});
