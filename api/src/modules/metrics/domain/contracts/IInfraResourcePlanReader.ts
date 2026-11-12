import type { InfraRenderKey } from '../services/infraCostSettings';

/** Tipo do recurso na Render, deduzido do prefixo do id (`srv-`, `dpg-`, `red-`). */
export type InfraRenderResourceType = 'service' | 'postgres' | 'key_value';

/** Plano, instâncias e disco lidos da Render (COST-09). Campo ausente na resposta = `null` (desconhecido). */
export interface InfraResourcePlanReading {
  resourceKey: InfraRenderKey;
  resourceType: InfraRenderResourceType;
  /** Plano como a Render devolve (ex.: `standard`, `basic_1gb`). */
  plan: string | null;
  /** Serviço: `numInstances`; Postgres/Key Value: 1 (recurso único cobrado pelo plano). */
  instances: number | null;
  diskGb: number | null;
  suspended: boolean | null;
}

export type InfraRenderUnavailableReason =
  | 'not_configured'
  | 'rate_limited'
  | 'timeout'
  | 'auth'
  | 'not_found'
  | 'rejected_by_provider'
  | 'upstream';

/** Falha traduzida: nunca carrega id, URL, chave nem corpo da Render. */
export interface InfraRenderUnavailable {
  status: 'unavailable';
  reason: InfraRenderUnavailableReason;
  /** Só em `rate_limited`: `Retry-After`, senão `Ratelimit-Reset`; `null` se nenhum veio. */
  retryAfterSeconds?: number | null;
}

export type InfraRenderResult<T> = ({ status: 'ok' } & T) | InfraRenderUnavailable;

/**
 * Leitura da Render para os custos por hora (COST-09). Ids só na implementação (env do `worker`);
 * o contrato fala por chave lógica. Nunca lança por falha da Render: devolve `unavailable`.
 */
export interface IInfraResourcePlanReader {
  /** Chaves mapeadas em `INFRA_COST_RENDER_RESOURCES` (vazio = não configurado). */
  configuredKeys(): InfraRenderKey[];
  readResource(key: InfraRenderKey): Promise<InfraRenderResult<{ reading: InfraResourcePlanReading }>>;
  /**
   * Banda (GB) por serviço na janela `[start, end)`, de todos os serviços `srv-` mapeados (inclusive o
   * static). Convertida pelo `unit` da série; série sem unidade conhecida é descartada (`discardedSeries`).
   * Serviço sem série válida fica `null`.
   */
  readBandwidthGb(start: Date, end: Date): Promise<InfraRenderResult<{
    byKey: Partial<Record<InfraRenderKey, number | null>>;
    discardedSeries: number;
  }>>;
  /**
   * Minutos de build estimados (Σ `finishedAt − startedAt`, limite superior) dos deploys terminados em
   * `[start, end)`, por serviço `srv-` mapeado. Sem deploy = 0. Falha em qualquer serviço = `unavailable`.
   */
  readBuildMinutes(start: Date, end: Date): Promise<InfraRenderResult<{
    byKey: Partial<Record<InfraRenderKey, number>>;
  }>>;
}
