import { createHash } from 'crypto';
import { createCursor, readCursor } from '../../../shared/http/pagination/OpaqueCursor';
import type {
  PlatformSaverContactFilter,
  PlatformSaverContactKey,
} from '../domain/contracts/IPlatformSaverContactRepository';

/**
 * Cursor keyset assinado da base da plataforma (molde `metrics/.../infraCostTenantCursor.ts`, sem mudar o
 * `OpaqueCursor`): `base64url(chave)~cursor assinado`, com o hash da chave no escopo. O escopo também leva
 * o hash dos filtros: cursor de outro filtro, adulterado ou vencido = `null` (a rota responde 400).
 */
const SEPARATOR = '~';
const digest = (key: string) => createHash('sha256').update(key).digest('base64url');

export function platformSaverContactScope(filter: PlatformSaverContactFilter): string {
  const raw = JSON.stringify([
    filter.search?.trim() || null,
    filter.tenantId,
    filter.from?.toISOString() ?? null,
    filter.to?.toISOString() ?? null,
  ]);
  return `saver-platform-contacts|${digest(raw)}`;
}

export function createPlatformSaverContactCursor(scope: string, key: PlatformSaverContactKey): string {
  const raw = JSON.stringify({ s: key.lastSeenAt.toISOString(), i: key.id });
  return `${Buffer.from(raw).toString('base64url')}${SEPARATOR}${createCursor(`${scope}|${digest(raw)}`, 0)}`;
}

export function readPlatformSaverContactCursor(cursor: string, scope: string): PlatformSaverContactKey | null {
  const at = cursor.indexOf(SEPARATOR);
  if (at <= 0) return null;
  const raw = Buffer.from(cursor.slice(0, at), 'base64url').toString();
  if (readCursor(cursor.slice(at + 1), `${scope}|${digest(raw)}`) !== 0) return null;
  try {
    const parsed = JSON.parse(raw) as { s?: unknown; i?: unknown };
    if (typeof parsed.s !== 'string' || typeof parsed.i !== 'string' || !parsed.i) return null;
    const lastSeenAt = new Date(parsed.s);
    return Number.isNaN(lastSeenAt.getTime()) ? null : { lastSeenAt, id: parsed.i };
  } catch {
    return null;
  }
}
