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
