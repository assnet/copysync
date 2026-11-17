/**
 * Limites do Saver lidos do snapshot de entitlements (design.md §2.1, SAVER-03). Função pura.
 * Diferente do resto do projeto: chave AUSENTE = 0 / desligado; JSON `null` explícito = ilimitado.
 * Valores próprios (não importa `entitlementKeys.ts`); devem ser idênticos às chaves de lá.
 */
export const SAVER_LIMIT_KEYS = {
  GROUPS: 'saver_groups',
  GROUP_SCANS_PER_DAY: 'saver_group_scans_per_day',
  CONTACTS: 'saver_contacts',
  AUTO_REFRESH_ENABLED: 'saver_auto_refresh_enabled',
} as const;

export type SaverNumericLimitKey =
  | typeof SAVER_LIMIT_KEYS.GROUPS
  | typeof SAVER_LIMIT_KEYS.GROUP_SCANS_PER_DAY
  | typeof SAVER_LIMIT_KEYS.CONTACTS;

/** `null` = ilimitado; número ≥ 0 = teto. */
export type SaverLimit = number | null;

export type EntitlementSnapshot = Readonly<Record<string, unknown>>;

/** Ausente/valor inválido = 0; `null` explícito = ilimitado; número = piso inteiro ≥ 0. */
export function readSaverLimit(snapshot: EntitlementSnapshot, key: SaverNumericLimitKey): SaverLimit {
  if (!Object.prototype.hasOwnProperty.call(snapshot, key)) return 0;
  const value = snapshot[key];
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/** Só `true` liga; ausente ou qualquer outro valor = desligado. */
export function readSaverFlag(snapshot: EntitlementSnapshot, key: typeof SAVER_LIMIT_KEYS.AUTO_REFRESH_ENABLED): boolean {
  return snapshot[key] === true;
}

export interface SaverLimits {
  groups: SaverLimit;
  groupScansPerDay: SaverLimit;
  contacts: SaverLimit;
  autoRefreshEnabled: boolean;
}

export function readSaverLimits(snapshot: EntitlementSnapshot): SaverLimits {
  return {
    groups: readSaverLimit(snapshot, SAVER_LIMIT_KEYS.GROUPS),
    groupScansPerDay: readSaverLimit(snapshot, SAVER_LIMIT_KEYS.GROUP_SCANS_PER_DAY),
    contacts: readSaverLimit(snapshot, SAVER_LIMIT_KEYS.CONTACTS),
    autoRefreshEnabled: readSaverFlag(snapshot, SAVER_LIMIT_KEYS.AUTO_REFRESH_ENABLED),
  };
}

/** `used + adding` cabe no limite? Ilimitado sempre cabe. */
export function fitsSaverLimit(limit: SaverLimit, used: number, adding: number): boolean {
  if (limit === null) return true;
  return used + adding <= limit;
}

/** Vagas restantes (nunca negativo); `null` = ilimitado. */
export function remainingSaverLimit(limit: SaverLimit, used: number): number | null {
  if (limit === null) return null;
  return Math.max(0, limit - used);
}
