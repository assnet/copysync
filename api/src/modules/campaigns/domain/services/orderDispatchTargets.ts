import type { OfferDispatchOrder } from '../entities/OfferGeneratorConfig';

export interface DispatchTarget {
  conversationId: string;
  sessionId: string;
}

/**
 * Ordem dos envios com mais de uma sessão. Um envio por vez em todos os casos; a pausa entre
 * dois envios consecutivos é a mesma, seja na mesma sessão ou ao trocar de sessão.
 *
 * - SEQUENTIAL: todos os grupos da 1ª sessão, depois todos da 2ª…
 * - INTERLEAVED: um grupo de cada sessão por vez (S1, S2, S1, S2…); quando uma sessão acaba,
 *   as outras continuam alternando.
 *
 * Sessões seguem a ordem de `sessionIds`; grupos, a ordem em que chegaram. Grupo cuja sessão
 * não está em `sessionIds` fica de fora.
 */
export function orderDispatchTargets<T extends DispatchTarget>(
  targets: readonly T[],
  sessionIds: readonly string[],
  order: OfferDispatchOrder,
): T[] {
  const bySession = new Map<string, T[]>(sessionIds.map((id) => [id, []]));
  for (const t of targets) bySession.get(t.sessionId)?.push(t);
  const queues = sessionIds.map((id) => bySession.get(id)!).filter((q) => q.length > 0);

  if (order === 'SEQUENTIAL') return queues.flat();

  const result: T[] = [];
  const cursors = queues.map(() => 0);
  let remaining = queues.reduce((n, q) => n + q.length, 0);
  while (remaining > 0) {
    for (let i = 0; i < queues.length; i++) {
      const q = queues[i]!;
      if (cursors[i]! < q.length) {
        result.push(q[cursors[i]!]!);
        cursors[i]!++;
        remaining--;
      }
    }
  }
  return result;
}
