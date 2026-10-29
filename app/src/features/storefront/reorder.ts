/**
 * Ordem das ofertas numa aba (arrastar e ▲▼). Puro: devolve lista nova; sem mudança, a mesma
 * referência (o componente não re-renderiza nem chama a API). A API recebe a aba inteira
 * (`PUT /storefront/offers/order`).
 */
import type { StorefrontOfferStatus } from './types';

export type StorefrontOfferTab = 'drafts' | 'published';
export type MoveDirection = 'up' | 'down';

interface WithId {
  id: string;
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = list as T[];
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return out;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

const targetIndex = <T extends WithId>(list: readonly T[], from: number, target: MoveDirection | string): number => {
  if (target === 'up') return from - 1;
  if (target === 'down') return from + 1;
  return list.findIndex((o) => o.id === target);
};

/** `target`: 'up'/'down' (teclado) ou o id do item sobre o qual soltou (arrastar). */
export function moveById<T extends WithId>(list: readonly T[], id: string, target: MoveDirection | string): T[] {
  const from = list.findIndex((o) => o.id === id);
  if (from < 0) return list as T[];
  return moveItem(list, from, targetIndex(list, from, target));
}

/** Habilita ▲/▼: falso nas pontas. */
export function canMove<T extends WithId>(list: readonly T[], id: string, dir: MoveDirection): boolean {
  const from = list.findIndex((o) => o.id === id);
  if (from < 0) return false;
  const to = targetIndex(list, from, dir);
  return to >= 0 && to < list.length;
}

export const tabIds = <T extends WithId>(list: readonly T[]): string[] => list.map((o) => o.id);

export const tabStatus = (tab: StorefrontOfferTab): StorefrontOfferStatus => (tab === 'drafts' ? 'DRAFT' : 'PUBLISHED');
