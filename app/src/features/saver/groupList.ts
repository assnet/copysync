import type { SaverSessionGroup } from './types';

/** Filtros rápidos da lista de grupos da sessão. */
export const GROUP_FILTERS = ['all', 'unread', 'saved', 'communities'] as const;
export type GroupFilter = (typeof GROUP_FILTERS)[number];
export const GROUP_SORTS = ['name', 'members'] as const;
export type GroupSort = (typeof GROUP_SORTS)[number];
/** Quantos grupos entram na tela por vez ("Mostrar mais"). Sem rolagem interna. */
export const GROUP_PAGE_SIZE = 50;

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
const norm = (v: string) => v.toLocaleLowerCase('pt-BR');

export const groupMatchesFilter = (g: SaverSessionGroup, f: GroupFilter): boolean =>
  f === 'unread' ? g.lastScannedAt === null
    : f === 'saved' ? g.saved
      : f === 'communities' ? g.kind !== 'GROUP'
        : true;

/** Busca pelo nome (o texto de "sem nome" entra na busca). */
export function searchGroups(groups: readonly SaverSessionGroup[], search: string, untitled: string) {
  const q = norm(search.trim());
  return q ? groups.filter((g) => norm(g.name?.trim() || untitled).includes(q)) : [...groups];
}

/** Quantos grupos cada filtro mostra, já com a busca aplicada. */
export function countByFilter(groups: readonly SaverSessionGroup[]): Record<GroupFilter, number> {
  const out = { all: 0, unread: 0, saved: 0, communities: 0 } as Record<GroupFilter, number>;
  for (const g of groups) for (const f of GROUP_FILTERS) if (groupMatchesFilter(g, f)) out[f] += 1;
  return out;
}

/** Nome A–Z; "mais membros" decrescente, sem total no fim, empate pelo nome. */
export function sortGroups(groups: readonly SaverSessionGroup[], sort: GroupSort, untitled: string) {
  const name = (g: SaverSessionGroup) => g.name?.trim() || untitled;
  return [...groups].sort((a, b) => {
    if (sort === 'members') {
      const d = (b.memberCount ?? -1) - (a.memberCount ?? -1);
      if (d !== 0) return d;
    }
    return collator.compare(name(a), name(b));
  });
}
