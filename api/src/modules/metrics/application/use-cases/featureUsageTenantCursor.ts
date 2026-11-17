import { createHash } from 'crypto';
import { createCursor, readCursor } from '../../../../shared/http/pagination/OpaqueCursor';

/** Chave da última linha da página (keyset): usos da conta + `tenantId` (ordem `uses desc, tenantId asc`). */
export interface FeatureUsageTenantCursorKey {
  uses: number;
  tenantId: string;
}

const SEPARATOR = '~';
const digest = (key: string) => createHash('sha256').update(key).digest('base64url');

/** Escopo do cursor: recurso + hash do recorte. Cursor de outro recurso ou de outro recorte não vale. */
export function featureUsageTenantScope(featureKey: string, filters: Record<string, unknown>): string {
  return `usage-tenants:${featureKey}:${digest(JSON.stringify(filters))}`;
}

/**
 * Cursor keyset sobre o `OpaqueCursor` (molde `infraCostTenantCursor.ts`): `base64url(chave)~cursor assinado`,
 * com o hash da chave no escopo assinado. Chave adulterada, escopo trocado ou cursor vencido = `null`.
 */
export function createFeatureUsageTenantCursor(scope: string, key: FeatureUsageTenantCursorKey): string {
  const raw = JSON.stringify({ u: key.uses, t: key.tenantId });
  return `${Buffer.from(raw).toString('base64url')}${SEPARATOR}${createCursor(`${scope}|${digest(raw)}`, 0)}`;
}

export function readFeatureUsageTenantCursor(cursor: string, scope: string): FeatureUsageTenantCursorKey | null {
  const at = cursor.indexOf(SEPARATOR);
  if (at <= 0) return null;
  const raw = Buffer.from(cursor.slice(0, at), 'base64url').toString();
  if (readCursor(cursor.slice(at + 1), `${scope}|${digest(raw)}`) !== 0) return null;
  try {
    const parsed = JSON.parse(raw) as { u?: unknown; t?: unknown };
    if (typeof parsed.u !== 'number' || !Number.isInteger(parsed.u) || parsed.u < 0) return null;
    if (typeof parsed.t !== 'string' || !parsed.t) return null;
    return { uses: parsed.u, tenantId: parsed.t };
  } catch {
    return null;
  }
}
