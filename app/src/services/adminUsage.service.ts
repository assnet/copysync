import { apiClient } from './apiClient';
import type { ApiSuccess } from '@/types/api.types';
import type { UsageFeatureDetailResponse, UsageQuery, UsageSummary, UsageTenantsPage } from '@/features/featureUsage/types';

/**
 * Canal de leitura: quem pede no mesmo canal substitui o pedido anterior ainda na fila (resumo da página, tendência
 * da visão geral, detalhe do recurso, lista de contas).
 */
export type UsageReadChannel = 'summary' | 'trend' | 'detail' | 'tenants';

/**
 * Pedido descartado antes de ir à rede: o mesmo canal já tem um pedido mais novo na fila. Não é erro de tela
 * (`isUsageReadSuperseded` em `featureUsage/rules`).
 */
export class UsageReadSupersededError extends Error {
  readonly code = 'USAGE_READ_SUPERSEDED';
  constructor() {
    super('Usage read superseded by a newer request');
  }
}

interface QueuedRead {
  channel: UsageReadChannel;
  key: string;
  run: () => Promise<unknown>;
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * Fila única de leituras de uso **por aba** (estado do módulo; cada aba do navegador tem o seu). Garante uma leitura
 * de uso por vez na rede:
 * - só um pedido em voo; o próximo sai quando ele termina (sucesso ou erro). Troca de tela não cancela o que está em
 *   voo (o `apiClient` não cancela), mas quem vem depois espera ele terminar;
 * - pedido na fila é descartado (`UsageReadSupersededError`) quando chega outro do mesmo canal com chave diferente;
 * - mesma chave no mesmo canal (em voo ou na fila) devolve a mesma promessa: o duplo efeito do StrictMode e cliques
 *   repetidos não geram leitura a mais;
 * - sem retry automático.
 * A API também enfileira leituras sobrepostas (até 2 s), mas o painel não as gera.
 */
let inFlight: QueuedRead | null = null;
const waiting: QueuedRead[] = [];

function pump(): void {
  if (inFlight) return;
  const next = waiting.shift();
  if (!next) return;
  inFlight = next;
  next.run()
    .then(next.resolve, next.reject)
    .finally(() => {
      inFlight = null;
      pump();
    });
}

function enqueueRead<T>(channel: UsageReadChannel, key: string, run: () => Promise<T>): Promise<T> {
  // O descarte dos superados do canal vem antes de reaproveitar o pedido em voo.
  let same: QueuedRead | undefined;
  for (let i = waiting.length - 1; i >= 0; i -= 1) {
    const read = waiting[i];
    if (read.channel !== channel) continue;
    if (read.key === key) {
      same = read;
      continue;
    }
    waiting.splice(i, 1);
    read.reject(new UsageReadSupersededError());
  }
  if (inFlight && inFlight.channel === channel && inFlight.key === key) return inFlight.promise as Promise<T>;
  if (same) return same.promise as Promise<T>;

  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
  waiting.push({ channel, key, run, promise, resolve, reject });
  pump();
  return promise as Promise<T>;
}

/** Esvazia a fila (pedidos na fila são descartados): no logout (`AuthContext`) e entre casos de teste. */
export function resetUsageReadQueue(): void {
  inFlight = null;
  for (const read of waiting.splice(0)) read.reject(new UsageReadSupersededError());
}

const readKey = (path: string, params: UsageQuery) =>
  `${path}?${Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&')}`;

/**
 * Teto de cada leitura na rede. Sem ele um GET que nunca responde prenderia a fila da aba; o timeout vira falha
 * comum (alerta "Tentar de novo") e a fila anda. A API corta em 2 s; o resto é rede e fila do servidor.
 */
export const USAGE_READ_TIMEOUT_MS = 8_000;

function read<T>(channel: UsageReadChannel, path: string, params: UsageQuery): Promise<T> {
  return enqueueRead(channel, readKey(path, params), async () => {
    const res = await apiClient.get<ApiSuccess<T>>(path, { params, timeout: USAGE_READ_TIMEOUT_MS });
    return res.data.data;
  });
}

/**
 * Uso dos recursos — rotas só de super admin (`/admin/usage/*`). A query vem pronta de `toUsageQuery` (todo filtro
 * explícito). Todas as leituras passam pela fila acima. A lista de contas pagina só pelo `cursor` opaco devolvido
 * pela API (nunca `limit`/`offset`).
 */
export const adminUsageService = {
  getSummary(query: UsageQuery): Promise<UsageSummary> {
    return read('summary', '/admin/usage/summary', query);
  },

  /**
   * Detalhe do recurso. `channel = 'trend'` quando só a série serve (tendência da visão geral). Recurso fora dos
   * filtros de tipo/plano volta zerado com `inScope: false`; 404 `USAGE_METRICS_FEATURE_NOT_FOUND` só para chave
   * fora do catálogo.
   */
  getDetail(featureKey: string, query: UsageQuery, channel: 'detail' | 'trend' = 'detail'): Promise<UsageFeatureDetailResponse> {
    return read(channel, `/admin/usage/features/${encodeURIComponent(featureKey)}`, query);
  },

  /** Só depois que o detalhe respondeu. 400 `USAGE_METRICS_CURSOR_INVALID` → recomeçar do início. */
  getTenants(featureKey: string, query: UsageQuery, cursor?: string | null): Promise<UsageTenantsPage> {
    const params: UsageQuery = cursor ? { ...query, cursor } : { ...query };
    return read('tenants', `/admin/usage/features/${encodeURIComponent(featureKey)}/tenants`, params);
  },
};
