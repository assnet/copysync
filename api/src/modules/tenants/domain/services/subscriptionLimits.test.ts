import { describe, expect, it } from 'vitest';
import { ENTITLEMENT_KEYS } from '../entitlementKeys';
import { buildSubscriptionLimits, SUBSCRIPTION_HIDDEN_KEYS, SUBSCRIPTION_LIMIT_ITEMS, type SubscriptionUsage } from './subscriptionLimits';

const usage: SubscriptionUsage = {
  sessions: { whatsapp: 2, telegram: 0 },
  monitoredGroups: { whatsapp: 3, telegram: 1 },
  broadcastGroups: { whatsapp: 7, telegram: 4 },
  linkRotations: { whatsapp: 1, telegram: 0 },
  offerGenerationsToday: 12,
  aiRequestsToday: null,
};

const byKey = (items: ReturnType<typeof buildSubscriptionLimits>) => Object.fromEntries(items.map((i) => [i.key, i]));

describe('subscriptionLimits', () => {
  it('toda chave de ENTITLEMENT_KEYS tem decisão (exibida uma vez ou oculta)', () => {
    const shown = SUBSCRIPTION_LIMIT_ITEMS.map((i) => i.key);
    expect(new Set(shown).size).toBe(shown.length);
    expect([...shown, ...SUBSCRIPTION_HIDDEN_KEYS].sort()).toEqual(Object.values(ENTITLEMENT_KEYS).sort());
  });

  it('canal e kind por chave', () => {
    const m = Object.fromEntries(SUBSCRIPTION_LIMIT_ITEMS.map((i) => [i.key, i]));
    expect(m.whatsapp_sessions).toMatchObject({ channel: 'whatsapp', kind: 'count' });
    expect(m.telegram_broadcast_groups).toMatchObject({ channel: 'telegram', kind: 'count' });
    expect(m.offer_generations_per_day).toMatchObject({ channel: null, kind: 'daily' });
    expect(m.storefront_enabled).toMatchObject({ channel: null, kind: 'feature' });
  });

  it('snapshot vazio: numérico ilimitado, feature desligada salvo mention_all/ai_rewrite', () => {
    const r = byKey(buildSubscriptionLimits({}, usage));
    expect(r.whatsapp_sessions).toMatchObject({ used: 2, limit: null, enabled: true });
    expect(r.telegram_monitored_groups).toMatchObject({ used: 1, limit: null, enabled: true });
    expect(r.link_rotation_groups).toMatchObject({ used: null, limit: null });
    expect(r.offer_generations_per_day).toMatchObject({ used: 12, limit: null, enabled: true });
    expect(r.ai_requests_per_day).toMatchObject({ used: null, limit: null });
    expect(r.cross_session_dispatch).toMatchObject({ used: null, limit: null, enabled: false });
    expect(r.storefront_enabled.enabled).toBe(false);
    expect(r.offer_story_enabled.enabled).toBe(false);
    expect(r.marketplace_extension.enabled).toBe(false);
    expect(r.mention_all_enabled.enabled).toBe(true);
    expect(r.ai_rewrite_enabled.enabled).toBe(true);
  });

  it('valores explícitos: 0 bloqueia, string numérica e booleana aceitas, lixo = ausente', () => {
    const r = byKey(
      buildSubscriptionLimits(
        {
          telegram_sessions: 0,
          whatsapp_sessions: '3',
          broadcast_groups: 'abc',
          monitored_groups: null,
          mention_all_enabled: false,
          ai_rewrite_enabled: 'FALSE',
          cross_session_dispatch: 'true',
          storefront_enabled: true,
          offer_story_enabled: 'sim',
        },
        usage,
      ),
    );
    expect(r.telegram_sessions).toMatchObject({ used: 0, limit: 0, enabled: false });
    expect(r.whatsapp_sessions).toMatchObject({ limit: 3, enabled: true });
    expect(r.broadcast_groups).toMatchObject({ used: 7, limit: null, enabled: true });
    expect(r.monitored_groups.limit).toBeNull();
    expect(r.mention_all_enabled.enabled).toBe(false);
    expect(r.ai_rewrite_enabled.enabled).toBe(false);
    expect(r.cross_session_dispatch.enabled).toBe(true);
    expect(r.storefront_enabled.enabled).toBe(true);
    expect(r.offer_story_enabled.enabled).toBe(false);
  });
});
