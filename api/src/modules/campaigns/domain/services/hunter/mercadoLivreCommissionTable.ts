// Comissão ML estimada por categoria raiz (venda direta), usada SÓ quando o cartão do hub vem sem o chip
// `affiliates_commission_chip` → candidato com `commissionEstimated: true`. Puro: sem infra.
//
// Fonte: página oficial do Programa de Afiliados ML "Como calcular seus ganhos", cópia lida em 2026-11-06
// (design `.specs/features/offer-hunter-multi/design.md` §1): venda direta 16% (beleza, moda, esportes),
// 12% (casa, bebês, brinquedos, ferramentas…), 5% (eletrônicos, celulares, informática…), 0% (alimentos).
// "Ganhos extras" pagos pelo vendedor não entram (só aparecem no painel/hub).
// Só as categorias raiz citadas nominalmente pela página estão aqui; as demais ficam sem estimativa (null) para não
// inventar percentual. Ids das categorias raiz = filtro `category` do hub (2026-11-13).

export const MERCADO_LIVRE_COMMISSION_TABLE_READ_AT = '2026-11-06';

const TABLE: Readonly<Record<string, number>> = {
  MLB1246: 16, // Beleza e Cuidado Pessoal
  MLB1430: 16, // Calçados, Roupas e Bolsas (moda)
  MLB1276: 16, // Esportes e Fitness
  MLB1574: 12, // Casa, Móveis e Decoração
  MLB1384: 12, // Bebês
  MLB1132: 12, // Brinquedos e Hobbies
  MLB263532: 12, // Ferramentas
  MLB1000: 5, // Eletrônicos, Áudio e Vídeo
  MLB1051: 5, // Celulares e Telefones
  MLB1648: 5, // Informática
  MLB1403: 0, // Alimentos e Bebidas
};

/** Percentual estimado (0–100) da categoria raiz; null quando a tabela não cobre a categoria ou não há categoria. */
export function estimateMercadoLivreCommissionPct(rootCategoryId: string | null | undefined): number | null {
  if (!rootCategoryId) return null;
  const pct = TABLE[rootCategoryId.trim().toUpperCase()];
  return pct === undefined ? null : pct;
}
