import { createContext, useContext } from 'react';
import type { UsageFilters, UsageQuery } from '../types';
import type { LoadedAccountNames } from './useLoadedAccountNames';
import type { UsageSummaryState } from './useUsageSummary';

/** Visão da aba Telas: ranking (gráfico) ou tabela alternativa (com o cruzamento que lê o resumo). */
export type ScreensView = 'chart' | 'table';
export const parseScreensView = (raw: unknown): ScreensView => (raw === 'table' ? 'table' : 'chart');

/**
 * Estado compartilhado da página de uso, montado uma vez em `AdminUsagePage` e lido pelos contêineres das abas.
 * Assim cada aba monta seus componentes sem tocar na página.
 */
export interface UsagePageValue {
  filters: UsageFilters;
  setFilters: (next: UsageFilters) => void;
  /** Query do recorte atual (todo filtro explícito); a mesma serve ao detalhe e à lista de contas. */
  query: UsageQuery;
  /** Teto do período em vigor: `range.maxDays` da última resposta ou o do painel. */
  maxDays: number;
  /** Resumo (desligado no detalhe, que não usa o resumo). */
  summary: UsageSummaryState;
  /** Muda a cada "Atualizar" do cabeçalho; hooks de leitura das abas incluem nas dependências. */
  refreshKey: number;
  /** Registro o teto informado por qualquer resposta (`range.maxDays`). */
  reportMaxDays: (maxDays: number) => void;
  /** Recurso aberto no detalhe (da URL), ou `null`. */
  featureKey: string | null;
  accountNames: LoadedAccountNames;
  /** Visão da aba Telas (`usage.screensView`, escopo `tab`). Na aba Telas o resumo só é lido com a tabela aberta. */
  screensView: ScreensView;
  setScreensView: (view: ScreensView) => void;
}

export const UsagePageContext = createContext<UsagePageValue | null>(null);

export function useUsagePage(): UsagePageValue {
  const value = useContext(UsagePageContext);
  if (!value) throw new Error('useUsagePage deve ser usado dentro de AdminUsagePage');
  return value;
}
