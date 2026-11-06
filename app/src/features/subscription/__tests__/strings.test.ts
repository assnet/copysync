import { describe, expect, it } from 'vitest';
// Fonte única das chaves na API (arquivo puro, sem dependências): chave nova sem linha nesta tela falha aqui.
import { ENTITLEMENT_KEYS } from '../../../../../api/src/modules/tenants/domain/entitlementKeys';
import { PRIVACY_SCREENS } from '@/features/privacy';
import { SUBSCRIPTION_LIMIT_KEYS, minPlanFor, planNameOf, subscriptionStrings } from '../strings';

function leaves(obj: unknown, path = ''): [string, unknown][] {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.entries(obj).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  }
  return [[path, obj]];
}

describe('subscriptionStrings', () => {
  it('nenhum texto vazio', () => {
    for (const [path, v] of leaves(subscriptionStrings)) {
      if (typeof v === 'function') continue;
      expect(typeof v, path).toBe('string');
      expect((v as string).trim(), path).not.toBe('');
    }
  });

  it('chaves de limite iguais a ENTITLEMENT_KEYS da API', () => {
    expect([...SUBSCRIPTION_LIMIT_KEYS].sort()).toEqual(Object.values(ENTITLEMENT_KEYS).sort());
  });

  it('todo limite tem rótulo, hint e plano mínimo', () => {
    for (const key of SUBSCRIPTION_LIMIT_KEYS) {
      expect(subscriptionStrings.limit[key].label, key).toBeTruthy();
      expect(subscriptionStrings.limit[key].hint, key).toBeTruthy();
      expect(minPlanFor(key), key).not.toBeNull();
    }
  });

  it('plano mínimo pelo catálogo', () => {
    expect(minPlanFor('whatsapp_sessions')?.slug).toBe('lite');
    expect(minPlanFor('telegram_sessions')?.slug).toBe('pro');
    expect(minPlanFor('telegram_link_rotations')?.slug).toBe('pro');
    expect(minPlanFor('storefront_enabled')?.slug).toBe('pro');
    expect(minPlanFor('offer_story_enabled')?.slug).toBe('max');
    expect(minPlanFor('cross_session_dispatch')?.slug).toBe('max');
  });

  it('"A partir do X" com nome de vitrine', () => {
    expect(subscriptionStrings.limits.availableFrom(minPlanFor('telegram_sessions')!.name)).toBe('A partir do PRO');
    expect(subscriptionStrings.limits.availableFrom(minPlanFor('offer_story_enabled')!.name)).toBe('A partir do MAX');
  });

  it('nome do plano pelo slug; sem plano = null', () => {
    expect(planNameOf('lite')).toBe('LITE');
    expect(planNameOf(null)).toBeNull();
  });

  it('uso formatado', () => {
    expect(subscriptionStrings.limits.usage(3, 10)).toBe('3 de 10');
    expect(subscriptionStrings.limits.usageToday(1200, 2000)).toBe('1.200 de 2.000 hoje');
    expect(subscriptionStrings.limits.usageUnlimited(4)).toBe('4 em uso');
  });

  it('flag de privacidade do nome da conta registrada', () => {
    const ids = PRIVACY_SCREENS.find((s) => s.id === 'subscription')?.flags.map((f) => f.id);
    expect(ids).toEqual(['subscription.tenantName']);
  });
});
