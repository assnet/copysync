import { createHash } from 'crypto';
import { createCursor, readCursor } from '../../../../shared/http/pagination/OpaqueCursor';

/** Chave da última linha da página (keyset): valor da ordenação (texto do SQL) + `tenantId`. */
export interface InfraCostTenantCursorKey {
  sortKey: string;
  tenantId: string;
}

const SEPARATOR = '~';
const digest = (key: string) => createHash('sha256').update(key).digest('base64url');

/**
 * Cursor keyset da lista por cliente sobre o `OpaqueCursor` (sem mudá-lo): `base64url(chave)~cursor assinado`,
 * com o hash da chave no escopo assinado. Chave adulterada, escopo trocado ou cursor expirado = `null`.
 */
export function createInfraCostTenantCursor(scope: string, key: InfraCostTenantCursorKey): string {
  const raw = JSON.stringify({ k: key.sortKey, t: key.tenantId });
  return `${Buffer.from(raw).toString('base64url')}${SEPARATOR}${createCursor(`${scope}|${digest(raw)}`, 0)}`;
}

export function readInfraCostTenantCursor(cursor: string, scope: string): InfraCostTenantCursorKey | null {
  const at = cursor.indexOf(SEPARATOR);
  if (at <= 0) return null;
  const raw = Buffer.from(cursor.slice(0, at), 'base64url').toString();
  if (readCursor(cursor.slice(at + 1), `${scope}|${digest(raw)}`) !== 0) return null;
  try {
    const parsed = JSON.parse(raw) as { k?: unknown; t?: unknown };
    if (typeof parsed.k !== 'string' || typeof parsed.t !== 'string' || !parsed.t) return null;
    return { sortKey: parsed.k, tenantId: parsed.t };
  } catch {
    return null;
  }
}
