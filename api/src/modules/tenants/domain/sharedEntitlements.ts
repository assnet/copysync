import { ENTITLEMENT_KEYS } from './entitlementKeys';
import type { PlanPresetValue } from './planPresets';

/**
 * Chaves compartilhadas entre produtos (sessões são recurso do tenant). O sync do plano de produto novo
 * as exclui; só o merge abaixo as escreve (ver `docs/acesso-por-produto.md`).
 */
export const SHARED_KEYS = [ENTITLEMENT_KEYS.WHATSAPP_SESSIONS, ENTITLEMENT_KEYS.TELEGRAM_SESSIONS] as const;
export type SharedEntitlementKey = (typeof SHARED_KEYS)[number];

export type SharedEntitlements = Partial<Record<SharedEntitlementKey, number | null>>;

/**
 * União das chaves compartilhadas entre os presets dos produtos ativos: maior número vence; `null`
 * (ilimitado) vence tudo. Entrada `null` = produto ativo sem plano (tenant legado sem limites):
 * devolve `null` = não gravar nada. Chave ausente em todos os presets fica de fora.
 */
export function mergeSharedEntitlements(
  presets: ReadonlyArray<Readonly<Record<string, PlanPresetValue>> | null>,
): SharedEntitlements | null {
  if (presets.some((p) => p === null)) return null;
  const merged: SharedEntitlements = {};
  for (const key of SHARED_KEYS) {
    for (const preset of presets as ReadonlyArray<Readonly<Record<string, PlanPresetValue>>>) {
      if (!Object.prototype.hasOwnProperty.call(preset, key)) continue;
      const value = preset[key];
      if (value !== null && typeof value !== 'number') continue;
      const current = merged[key];
      if (current === null) continue;
      if (value === null || current === undefined || value > current) merged[key] = value;
    }
  }
  return merged;
}
