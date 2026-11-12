/**
 * Contratos dos custos da infraestrutura (super admin). Espelham `GET`/`PUT /admin/costs/settings` e
 * `GET /admin/costs/summary` (`.specs/features/infra-costs/spec.md`, COST-01…07).
 *
 * Preço de plano (R$) nunca trafega: a margem é calculada no painel com `PLAN_CATALOG` (COST-06).
 * Valores em USD com 4 casas; BRL = USD × cotação no servidor, `null` sem cotação.
 */

import type { AiProviderKind } from '@/types/api.types';
import type { PlanSlug } from '@/features/plans/catalog';

/* ── Configuração (COST-01) ─────────────────────────────────────────── */

export type InfraCostCategory =
  | 'compute' | 'database' | 'cache' | 'static' | 'storage' | 'ai' | 'email' | 'platform' | 'other';
/** `fixed` = US$/mês × quantidade · `per_instance` = US$/mês por instância · `usage` = total do mês informado. */
export type InfraCostBilling = 'fixed' | 'per_instance' | 'usage';
/** Chave lógica que liga o item à leitura do recurso (nunca o id do provedor). */
export type InfraRenderKey = 'api' | 'worker' | 'redis' | 'postgres' | 'static';
export type InfraCostAllocation = 'shared' | 'excluded';
export type InfraRenderResourceType = 'service' | 'postgres' | 'key_value';
export type InfraFxClosingMethod = 'last_business_day' | 'month_average';

/** Armazenamento do item. `gb` ou `usdPerGb` nulo = a confirmar (soma só a computação). */
export interface InfraCostStorage {
  gb: number | null;
  usdPerGb: number | null;
}

export interface InfraCostItem {
  /** Slug estável e único. */
  key: string;
  label: string;
  category: InfraCostCategory;
  billing: InfraCostBilling;
  /** Componente de computação/plano (0–100.000). */
  monthlyUsd: number;
  /** Quantidade manual (inteiro 0–100). */
  quantity: number;
  storage: InfraCostStorage | null;
  renderKey: InfraRenderKey | null;
  /** Texto livre (até 80), ex.: "Standard 1 CPU/2 GB"; vazio = `null`. */
  planLabel: string | null;
  allocation: InfraCostAllocation;
  /** Até 280 caracteres; vazio = `null`. */
  note: string | null;
}

export interface InfraRenderPlanPrice {
  resourceType: InfraRenderResourceType;
  /** Nome do plano como o provedor devolve (ex.: `1c-2g`). */
  plan: string;
  monthlyUsd: number;
}

export interface InfraAiModelPrice {
  kind: AiProviderKind;
  model: string;
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
}

export interface InfraWorkspaceSettings {
  /** Obrigatório (até 80). */
  planLabel: string;
  /** Dia de início do ciclo (1–28). */
  cycleStartDay: number;
  includedBandwidthGb: number;
  /** Inteiro. */
  includedBuildMinutes: number;
  bandwidthUsdPerGb: number;
  buildUsdPer1000Min: number;
  /** Preenchido vence a medição. */
  manualBandwidthGb: number | null;
  /** Inteiro. */
  manualBuildMinutes: number | null;
}

export interface InfraFxOverride {
  /** 1–20, até 4 casas. */
  rate: number;
  /** `YYYY-MM-DD`. */
  date: string;
}

export interface InfraFxSettings {
  auto: boolean;
  /** Vale sobre todas as fontes até ser removido. */
  override: InfraFxOverride | null;
  closingMethod: InfraFxClosingMethod;
}

export interface InfraCostSettings {
  fx: InfraFxSettings;
  items: InfraCostItem[];
  renderPlanPrices: InfraRenderPlanPrice[];
  aiModelPrices: InfraAiModelPrice[];
  workspace: InfraWorkspaceSettings;
}

/** `default` = valores iniciais do código (sem linha salva ou linha inválida). */
export type InfraCostSettingsSource = 'default' | 'saved';

/** Resposta de `GET`/`PUT /admin/costs/settings`. */
export interface InfraCostSettingsView {
  settings: InfraCostSettings;
  origin: InfraCostSettingsSource;
  /** ISO; `null` = nunca salvo. */
  updatedAt: string | null;
}

/** Corpo de `PUT /admin/costs/settings`. 400 `INVALID_INFRA_COST_SETTINGS` (`meta.field`) · 409 `INFRA_COST_SETTINGS_CONFLICT`. */
export interface UpdateInfraCostSettingsInput {
  settings: InfraCostSettings;
  expectedUpdatedAt: string | null;
}

/**
 * Rascunho do formulário: todo número pode vir como texto do input. Caminho de campo no formato
 * `items[0].monthlyUsd`, o mesmo do `meta.field` do 400.
 */
export type InfraCostDraft<T = InfraCostSettings> = T extends number
  ? number | string
  : T extends (infer U)[]
    ? InfraCostDraft<U>[]
    : T extends object
      ? { [K in keyof T]: InfraCostDraft<T[K]> }
      : T;

export type InfraCostSettingsDraft = InfraCostDraft<InfraCostSettings>;

export type InfraCostChangeKind = 'changed' | 'added' | 'removed';

/** Linha do diff mostrado na confirmação. */
export interface InfraCostSettingsChange {
  kind: InfraCostChangeKind;
  /** Ex.: `items[api].monthlyUsd`, `renderPlanPrices[service:1c-2g]`, `fx.override.rate`. */
  path: string;
  from: string | number | boolean | null;
  to: string | number | boolean | null;
}

/* ── Resumo (COST-04…07, COST-02a, COST-06a) ────────────────────────── */

/** Valor em USD (4 casas) e BRL (`null` sem cotação). */
export interface InfraMoney {
  usd: number;
  brl: number | null;
}

export type InfraFxSource = 'override' | 'ptax' | 'sgs' | 'last_known';

export interface InfraFxView {
  rate: number;
  /** `YYYY-MM-DD`. */
  referenceDate: string;
  source: InfraFxSource;
  fetchedAt: string | null;
  /** Mais de 5 dias corridos. */
  stale: boolean;
}

/** `snapshot` = foto do momento × mês inteiro (P1) · `hours` = soma por hora (P2+). */
export type InfraCostBasis = 'snapshot' | 'hours';
export type InfraQuantitySource = 'manual' | 'measured_now' | 'measured_hours';

export interface InfraNeighborPlan {
  plan: string;
  monthly: InfraMoney;
  /** Diferença mensal contra o plano atual (negativa = mais barato). */
  diff: InfraMoney;
}

export interface InfraCostItemView {
  key: string;
  label: string;
  category: InfraCostCategory;
  billing: InfraCostBilling;
  renderKey: InfraRenderKey | null;
  planLabel: string | null;
  /** Plano lido do provedor; `null` sem leitura. */
  plan: string | null;
  quantity: number;
  quantitySource: InfraQuantitySource;
  allocation: InfraCostAllocation;
  /** `null` = plano lido sem preço (`plan_without_price`). */
  compute: InfraMoney | null;
  /** `null` = sem armazenamento ou a confirmar. */
  storage: InfraMoney | null;
  storageToConfirm: boolean;
  /** compute + storage; `null` quando compute é `null`. */
  cost: InfraMoney | null;
  /** Usa quantidade manual. */
  estimated: boolean;
  /** Planos vizinhos na tabela de preços (só com `renderKey`); `null` nas pontas. */
  neighbors: { lower: InfraNeighborPlan | null; upper: InfraNeighborPlan | null } | null;
}

export type InfraUsageSource = 'manual' | 'measured';

export interface InfraWorkspaceUsageView {
  included: number;
  /** `null` sem leitura nem valor manual. */
  consumed: number | null;
  source: InfraUsageSource | null;
  overage: number;
  cost: InfraMoney;
}

export interface InfraWorkspaceView {
  planLabel: string;
  /** GB. */
  bandwidth: InfraWorkspaceUsageView;
  /** Minutos. */
  build: InfraWorkspaceUsageView;
  total: InfraMoney;
}

/** Rateio na base padrão (sessões contratadas efetivas). */
export interface InfraContractedBasisView {
  sessions: number;
  perSession: InfraMoney | null;
  /** Tenants ilimitados contados pelo preset do plano (`unlimited_contracted`). */
  unlimitedTenants: number;
}

/** Segunda leitura (sessões conectadas de tenants ativos). */
export interface InfraConnectedBasisView {
  sessions: number;
  perSession: InfraMoney | null;
  /** Conectadas no cluster sem tenant ativo; `null` sem amostra. */
  unallocatedSessions: number | null;
  unallocatedCost: InfraMoney | null;
}

export interface InfraCostPlanView {
  /** Slug do domínio (`COPYSYNC_LITE`…); `null` = tenants sem plano. */
  planSlug: string | null;
  tenants: number;
  contractedSessions: number;
  connectedSessions: number;
  /** Parte do plano na base contratadas. */
  share: InfraMoney | null;
  /** Tenant médio = parte ÷ tenants (`null` com 0 tenants). Base da margem. */
  costPerTenant: InfraMoney | null;
  connectedShare: InfraMoney | null;
  connectedCostPerTenant: InfraMoney | null;
}

export type InfraCostWarningCode =
  | 'config_drift'
  | 'fx_fallback'
  | 'fx_missing'
  | 'ai_tokens_missing'
  | 'plan_without_price'
  | 'model_without_price'
  | 'missing_hours'
  | 'storage_to_confirm'
  | 'unlimited_contracted';
// A API também envia `sessions_sample_stale` (amostra de sessões > 10 min: não alocadas `null`).
// Entra na união junto com o texto em `strings.ts` (`satisfies Record<InfraCostWarningCode, string>`).

export interface InfraCostWarning {
  code: InfraCostWarningCode;
  resourceKey?: string;
  key?: string;
  plan?: string;
  field?: string;
  model?: string;
  count?: number;
}

/** Resposta de `GET /admin/costs/summary?month=YYYY-MM`. */
export interface InfraCostSummary {
  /** `YYYY-MM`. */
  month: string;
  basis: InfraCostBasis;
  generatedAt: string;
  /** `null` = sem cotação (só USD, aviso `fx_missing`). */
  fx: InfraFxView | null;
  /** Hora (ISO) da amostra de sessões do cluster; `null` = sem amostra. Opcional: API anterior não envia. */
  sessionsSampledAt?: string | null;
  /** Algum item sem preço: o total soma só o que tem preço. */
  totalIsPartial: boolean;
  totals: {
    total: InfraMoney;
    fixed: InfraMoney;
    variable: InfraMoney;
    shared: InfraMoney;
    /** Projeção até o fim do mês (P2+); `null` na P1. */
    projected: InfraMoney | null;
  };
  items: InfraCostItemView[];
  workspace: InfraWorkspaceView;
  perSession: { contracted: InfraContractedBasisView; connected: InfraConnectedBasisView };
  /** Preço da instância ÷ (teto × ratio de alerta); `null` sem preço. */
  marginalPerSession: InfraMoney | null;
  plans: InfraCostPlanView[];
  warnings: InfraCostWarning[];
}

/* ── Painel ─────────────────────────────────────────────────────────── */

export type InfraCostSplitBasis = 'contracted' | 'connected';

/** Filtros persistidos (`costs.filters`, escopo `tab`). `month: null` = mês corrente do servidor. */
export interface CostFilters {
  month: string | null;
  basis: InfraCostSplitBasis;
  plan: PlanSlug | 'all';
}

export interface PlanMarginLine {
  /** Preço de vitrine (R$/mês). */
  priceBrl: number;
  marginBrl: number;
  /** Percentual sobre o preço; `null` com preço 0. */
  marginPct: number | null;
}

/** Margem bruta de infraestrutura do plano: mensal e anual-equivalente. */
export interface PlanMargin {
  slug: PlanSlug;
  monthly: PlanMarginLine;
  annual: PlanMarginLine;
}
