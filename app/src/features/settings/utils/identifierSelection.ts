/**
 * Escolha de etiquetas da conta (principal + vinculadas) no painel. Regras puras: a API valida de
 * novo (`SetLinkedAffiliateIdentifiersUseCase`); aqui só se evita montar um pedido que ela recusaria.
 * `limit` conta a principal (LITE 1, PRO 2, MAX 10).
 */
export interface IdentifierSelection {
  primary: string | null;
  linked: string[];
}

/** Descarta o que saiu da conta (sincronização nova) e repetições; vinculadas acima do limite caem. */
export function sanitizeSelection(sel: IdentifierSelection, account: readonly string[], limit: number): IdentifierSelection {
  const inAccount = new Set(account);
  const primary = sel.primary && inAccount.has(sel.primary) ? sel.primary : null;
  const linked = [...new Set(sel.linked)].filter((tag) => tag !== primary && inAccount.has(tag));
  return { primary, linked: linked.slice(0, Math.max(0, limit - 1)) };
}

/** Quantas etiquetas a seleção ocupa no plano (principal incluída). */
export function usedOf(sel: IdentifierSelection): number {
  return (sel.primary ? 1 : 0) + sel.linked.length;
}

/** Sem vaga para vincular mais uma (a principal vazia ainda reserva a vaga dela). */
export function isFull(sel: IdentifierSelection, limit: number): boolean {
  return sel.linked.length >= limit - 1;
}

/** Nova principal: sai das vinculadas; a antiga vira vinculada se couber. */
export function choosePrimary(sel: IdentifierSelection, tag: string, limit: number): IdentifierSelection {
  if (sel.primary === tag) return sel;
  const linked = sel.linked.filter((t) => t !== tag);
  if (sel.primary && linked.length < limit - 1) linked.push(sel.primary);
  return { primary: tag, linked };
}

/** Marca/desmarca vinculada; acima do limite não muda (a linha já aparece indisponível). */
export function toggleLinked(sel: IdentifierSelection, tag: string, limit: number): IdentifierSelection {
  if (tag === sel.primary) return sel;
  if (sel.linked.includes(tag)) return { ...sel, linked: sel.linked.filter((t) => t !== tag) };
  if (sel.linked.length >= limit - 1) return sel;
  return { ...sel, linked: [...sel.linked, tag] };
}

export function sameSelection(a: IdentifierSelection, b: IdentifierSelection): boolean {
  return a.primary === b.primary && a.linked.length === b.linked.length && a.linked.every((t, i) => t === b.linked[i]);
}
