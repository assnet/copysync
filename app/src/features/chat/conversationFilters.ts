import type { ChatConversation, ConversationFilter, ConversationListFilter } from './types';

const LIST_PREFIX = 'list:';

/** Filtro que mostra só as conversas da lista `name`. */
export function listFilter(name: string): ConversationListFilter {
  return `${LIST_PREFIX}${name}`;
}

/** Nome da lista de um filtro `list:<nome>`; `null` para os filtros fixos. */
export function listFilterName(filter: ConversationFilter): string | null {
  if (!filter.startsWith(LIST_PREFIX)) return null;
  const name = filter.slice(LIST_PREFIX.length);
  return name.length > 0 ? name : null;
}

/** Nomes de lista já usados pelas conversas, sem repetição e em ordem alfabética. */
export function collectKnownLists(conversations: ReadonlyArray<Pick<ChatConversation, 'lists'>>): string[] {
  const all = new Set<string>();
  for (const c of conversations) for (const l of c.lists ?? []) all.add(l);
  return [...all].sort((a, b) => a.localeCompare(b));
}

/** Quantidade de conversas que pertencem à lista `name`. */
export function countInList(conversations: ReadonlyArray<Pick<ChatConversation, 'lists'>>, name: string): number {
  return conversations.filter((c) => c.lists?.includes(name)).length;
}

export const LIST_NAME_MAX_LENGTH = 40;

export type ListNameError = 'empty' | 'tooLong' | 'duplicate';

/**
 * Valida o nome de uma nova lista contra as existentes. O nome é comparado aparado e
 * sem diferenciar maiúsculas: "Clientes" e "clientes" seriam a mesma lista para quem lê.
 */
export function validateListName(raw: string, existing: ReadonlyArray<string>): ListNameError | null {
  const name = raw.trim();
  if (name.length === 0) return 'empty';
  if (name.length > LIST_NAME_MAX_LENGTH) return 'tooLong';
  const lower = name.toLowerCase();
  if (existing.some((e) => e.trim().toLowerCase() === lower)) return 'duplicate';
  return null;
}

export interface ListUpdatePlan {
  id: string;
  lists: string[];
}

/**
 * Planeja renomear, reorganizar ou excluir uma lista. Uma lista não tem registro próprio:
 * é o nome gravado em `lists` de cada conversa, então mudar a lista é regravar esse campo
 * conversa a conversa. Devolve só as que mudam, com o `lists` final de cada uma.
 *
 * - `oldName` sai de todas as conversas que o carregam
 * - `newName` entra nas conversas de `memberIds` (sem repetir, no fim da lista)
 * - `newName === null` é exclusão: `memberIds` é ignorado
 *
 * Só as conversas recebidas contam: quem não está carregado no painel fica como está.
 */
export function planListUpdate(
  conversations: ReadonlyArray<Pick<ChatConversation, 'id' | 'lists'>>,
  oldName: string,
  newName: string | null,
  memberIds: ReadonlyArray<string> = [],
): ListUpdatePlan[] {
  const members = newName === null ? new Set<string>() : new Set(memberIds);
  const plan: ListUpdatePlan[] = [];
  for (const c of conversations) {
    const current = c.lists ?? [];
    const without = current.filter((l) => l !== oldName);
    const next = members.has(c.id) && newName !== null
      ? [...without.filter((l) => l !== newName), newName]
      : without;
    const changed = next.length !== current.length || next.some((l, i) => l !== current[i]);
    if (changed) plan.push({ id: c.id, lists: next });
  }
  return plan;
}
