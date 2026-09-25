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
 * Planeja deixar exatamente `memberIds` na lista `name`. A lista tem registro próprio no
 * catálogo do tenant; o que se grava conversa a conversa é só a pertença. Devolve apenas as
 * conversas que mudam, com o `lists` final de cada uma: `name` entra nas de `memberIds` (sem
 * repetir, no fim) e sai das demais.
 *
 * Só as conversas recebidas contam: quem não está carregado no painel fica como está.
 */
export function planListMembers(
  conversations: ReadonlyArray<Pick<ChatConversation, 'id' | 'lists'>>,
  name: string,
  memberIds: ReadonlyArray<string>,
): ListUpdatePlan[] {
  const members = new Set(memberIds);
  const plan: ListUpdatePlan[] = [];
  for (const c of conversations) {
    const current = c.lists ?? [];
    const without = current.filter((l) => l !== name);
    const next = members.has(c.id) ? [...without, name] : without;
    const changed = next.length !== current.length || next.some((l, i) => l !== current[i]);
    if (changed) plan.push({ id: c.id, lists: next });
  }
  return plan;
}

/**
 * Espelho local de um renomeio já feito pelo servidor (que renomeia em cascata em todas as
 * conversas do tenant): troca `oldName` por `newName` em cada conversa carregada, sem repetir
 * se ela já carregava o novo. Conversas sem a lista voltam pela mesma referência.
 */
export function applyListRename<T extends Pick<ChatConversation, 'lists'>>(
  conversations: ReadonlyArray<T>,
  oldName: string,
  newName: string,
): T[] {
  return conversations.map((c) => {
    if (!c.lists?.includes(oldName)) return c;
    const lists = c.lists.filter((l) => l !== oldName && l !== newName);
    const at = c.lists.indexOf(oldName);
    lists.splice(Math.min(at, lists.length), 0, newName);
    return { ...c, lists };
  });
}

/** Espelho local de uma exclusão já feita pelo servidor: tira `name` de toda conversa carregada. */
export function applyListRemoval<T extends Pick<ChatConversation, 'lists'>>(
  conversations: ReadonlyArray<T>,
  name: string,
): T[] {
  return conversations.map((c) => (
    c.lists?.includes(name) ? { ...c, lists: c.lists.filter((l) => l !== name) } : c
  ));
}
