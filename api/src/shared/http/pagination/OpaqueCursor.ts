import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '../../config/env';

/**
 * Cursor opaco e assinado para paginação.
 *
 * O tamanho da página é decisão do servidor: o cliente recebe apenas um cursor
 * assinado e o devolve para pedir a próxima página. Sem isso, `limit` e `offset`
 * viriam do front e qualquer um poderia pedir a lista inteira alterando a requisição.
 *
 * A assinatura amarra o cursor ao recurso (`scope`), impedindo que um cursor emitido
 * para uma conversa seja usado em outra.
 */
interface CursorPayload {
  /** Recurso a que o cursor pertence, ex.: `participants:<conversationId>`. */
  s: string;
  /** Posição na coleção. */
  o: number;
  /** Expiração em epoch (segundos). */
  e: number;
}

/** Cursores são de navegação, não de sessão: meia hora cobre a rolagem de uma lista. */
const TTL_SECONDS = 30 * 60;

function sign(data: string): string {
  return createHmac('sha256', env.JWT_SECRET).update(data).digest('base64url');
}

export function createCursor(scope: string, offset: number): string {
  const payload: CursorPayload = {
    s: scope,
    o: offset,
    e: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

/**
 * Devolve o offset do cursor, ou null quando ele é inválido, expirou ou pertence a
 * outro recurso. Nunca lança: um cursor ruim é tratado como "comece do início".
 */
export function readCursor(cursor: string | undefined, scope: string): number | null {
  if (!cursor) return null;

  const [body, signature] = cursor.split('.');
  if (!body || !signature) return null;

  const expected = sign(body);
  // Comparação em tempo constante: a validação do cursor não deve vazar a assinatura.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as CursorPayload;
    if (payload.s !== scope) return null;
    if (payload.e < Math.floor(Date.now() / 1000)) return null;
    if (!Number.isInteger(payload.o) || payload.o < 0) return null;
    return payload.o;
  } catch {
    return null;
  }
}
