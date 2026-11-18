import type { UsageReadBudget } from './IUsageReadGate';

/** Telas de uma família com as contas do recorte daquela família. */
export interface PageViewScope {
  keys: readonly string[];
  tenantIds: readonly string[];
}

export interface PageViewRow {
  key: string;
  /** Contas distintas que abriram a tela no período. */
  tenants: number;
  /** Pares dia × conta (uma marca por dia × conta × tela). */
  tenantDays: number;
}

/**
 * Ranking das telas (P3, design §4.6): consulta própria já agregada no SQL (uma linha por tela), fora das linhas
 * do resumo. Roda no orçamento e na vaga do pedido. Nunca devolve `tenantId`.
 */
export interface IPageViewReader {
  read(
    input: { fromDay: string; toDayExclusive: string; scopes: readonly PageViewScope[] },
    budget: UsageReadBudget,
  ): Promise<{ rows: PageViewRow[]; firstDataDay: string | null }>;
}
