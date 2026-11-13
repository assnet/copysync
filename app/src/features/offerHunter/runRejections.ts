import { commissionCopy, offerHunterStrings } from './strings';
import type { HuntProvider, HuntRejectionCounts, HuntRejectionKey } from './types';

const t = offerHunterStrings.rejections;

export interface HuntRejectionPart {
  key: HuntRejectionKey;
  count: number;
}

/** Recusas > 0 do maior para o menor (empate: ordem das chaves). Execução antiga (null) → lista vazia. */
export function rejectionParts(rejectedBy: HuntRejectionCounts | null | undefined): HuntRejectionPart[] {
  if (!rejectedBy) return [];
  return Object.entries(rejectedBy)
    .filter((e): e is [HuntRejectionKey, number] => e[0] in t.keys && typeof e[1] === 'number' && e[1] > 0)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * "0 no filtro: 21 por vendas, 14 por avaliações, 3 por nota". null = nada a mostrar (sem `rejectedBy`, ou nenhum
 * filtro barrou e algo passou). `hint` = dica de afrouxar só quando nada passou e um filtro (não a repetição) barrou.
 */
/** Rótulo da recusa na loja (a comissão muda de nome: "de 1ª compra" só na Shein). */
export function rejectionLabel(key: HuntRejectionKey, provider: HuntProvider = 'SHEIN'): string {
  const cc = commissionCopy(provider);
  if (key === 'minCommissionPct') return cc.rejection;
  if (key === 'minCommissionCents') return cc.rejectionValue;
  return t.keys[key];
}

export function rejectionSummary(
  rejectedBy: HuntRejectionCounts | null | undefined, matchedCount: number, provider: HuntProvider = 'SHEIN',
): { line: string; hint: boolean } | null {
  const parts = rejectionParts(rejectedBy);
  if (parts.length === 0) return null;
  return {
    line: t.line(matchedCount, parts.map((p) => t.item(p.count, rejectionLabel(p.key, provider)))),
    hint: matchedCount === 0 && parts.some((p) => p.key !== 'repeated'),
  };
}
