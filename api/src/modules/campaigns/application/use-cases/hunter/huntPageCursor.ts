import { createHash } from 'crypto';
import { createCursor, readCursor } from '../../../../../shared/http/pagination/OpaqueCursor';
import type { OfferHuntPageCursor } from '../../../domain/contracts/hunter/IOfferHuntRunRepository';

const SEPARATOR = '~';
const digest = (key: string) => createHash('sha256').update(key).digest('base64url');

/**
 * Cursor keyset (data + id do último item) sobre o `OpaqueCursor`, no desenho do cursor dos custos:
 * `base64url(chave)~cursor assinado`, com o hash da chave no escopo assinado. O escopo amarra tenant, caçada
 * e lista: cursor de outra caçada/lista, adulterado ou expirado = `null`.
 */
export function createHuntPageCursor(scope: string, key: OfferHuntPageCursor): string {
  const raw = JSON.stringify({ a: key.at.toISOString(), i: key.id });
  return `${Buffer.from(raw).toString('base64url')}${SEPARATOR}${createCursor(`${scope}|${digest(raw)}`, 0)}`;
}

export function readHuntPageCursor(cursor: string, scope: string): OfferHuntPageCursor | null {
  const at = cursor.indexOf(SEPARATOR);
  if (at <= 0) return null;
  const raw = Buffer.from(cursor.slice(0, at), 'base64url').toString();
  if (readCursor(cursor.slice(at + 1), `${scope}|${digest(raw)}`) !== 0) return null;
  try {
    const parsed = JSON.parse(raw) as { a?: unknown; i?: unknown };
    if (typeof parsed.a !== 'string' || typeof parsed.i !== 'string' || !parsed.i) return null;
    const date = new Date(parsed.a);
    return Number.isNaN(date.getTime()) ? null : { at: date, id: parsed.i };
  } catch {
    return null;
  }
}
