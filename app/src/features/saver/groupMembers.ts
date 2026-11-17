import type { SaverSessionGroup } from './types';

/** Soma dos membros dos grupos marcados; `partial` quando algum não informou o total. Nada marcado = null. */
export function sumSelectedMembers(groups: readonly SaverSessionGroup[], selection: readonly string[]) {
  const chosen = new Set(selection);
  const picked = groups.filter((x) => x.selectable && chosen.has(x.groupJid));
  if (picked.length === 0) return null;
  return {
    total: picked.reduce((n, x) => n + (x.memberCount ?? 0), 0),
    partial: picked.some((x) => x.memberCount === null),
  };
}
