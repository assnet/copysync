import type { ChatMessageReaction } from '../entities/ChatMessageReaction';

/** Teto de autores por emoji no tooltip; a contagem continua completa. */
const MAX_REACTORS = 10;

/** Chip de reação exibido no painel — mesmo shape no `PUT`, no `GET /messages` e no WS. */
export interface ReactionSummary {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  /** Autores para o tooltip (até 10), com nome já resolvido. */
  reactors: { name: string | null; phone: string | null }[];
}

/** Agregado completo de uma mensagem. */
export interface ReactionAggregate {
  /** Maior `updatedAt` das linhas (tombstones incluídos), em ISO; `null` sem linhas. */
  revision: string | null;
  reactions: ReactionSummary[];
}

/** Contato conhecido pelo telefone — só o nome importa aqui. */
export interface ReactionContact {
  name?: string | null;
}

/**
 * Agrega as linhas de reação de uma mensagem.
 *
 * Um cálculo só para `PUT`, `GET` e WS, para que nunca divirjam:
 * - `revision` conta tombstones: uma remoção precisa avançar a revisão, senão o painel
 *   descartaria o agregado como velho e o chip ficaria na tela
 * - a lista ignora tombstones, agrupa por emoji e ordena por contagem desc e depois pela
 *   primeira `reactedAt`
 * - nome do autor: contato pelo telefone → nome gravado na reação → `null`
 */
export function aggregateReactions(
  rows: readonly ChatMessageReaction[],
  contactsByPhone: ReadonlyMap<string, ReactionContact>,
): ReactionAggregate {
  let latest: Date | null = null;
  const groups = new Map<string, ChatMessageReaction[]>();

  for (const row of rows) {
    if (!latest || row.updatedAt.getTime() > latest.getTime()) latest = row.updatedAt;
    if (row.emoji === null) continue;
    const group = groups.get(row.emoji);
    if (group) group.push(row);
    else groups.set(row.emoji, [row]);
  }

  const reactions = [...groups.entries()]
    .map(([emoji, group]) => {
      const sorted = [...group].sort((a, b) => a.reactedAt.getTime() - b.reactedAt.getTime());
      return {
        firstAt: sorted[0].reactedAt.getTime(),
        summary: {
          emoji,
          count: sorted.length,
          reactedByMe: sorted.some((r) => r.fromMe),
          reactors: sorted.slice(0, MAX_REACTORS).map((r) => ({
            name: resolveName(r, contactsByPhone),
            phone: r.reactorPhone,
          })),
        } satisfies ReactionSummary,
      };
    })
    .sort((a, b) => b.summary.count - a.summary.count || a.firstAt - b.firstAt)
    .map((g) => g.summary);

  return { revision: latest ? latest.toISOString() : null, reactions };
}

function resolveName(
  row: ChatMessageReaction,
  contactsByPhone: ReadonlyMap<string, ReactionContact>,
): string | null {
  const contactName = row.reactorPhone ? contactsByPhone.get(row.reactorPhone)?.name : null;
  return contactName || row.reactorName || null;
}
