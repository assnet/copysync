import type { IOpsMetricsSampleReader } from '../../domain/contracts/IOpsMetricsSampleRepository';
import type { OpsMetricSample } from '../../domain/OpsMetric';
import type { IWorkerHeartbeatRepository, WorkerHeartbeat } from '../../../sessions/domain/contracts/IWorkerHeartbeatRepository';
import { WORKER_ALIVE_MS } from '../../../sessions/domain/services/sessionAdoptionPolicy';
import { createCursor, readCursor } from '../../../../shared/http/pagination/OpaqueCursor';
import { ValidationError } from '../../../../shared/errors/internal/ResourceErrors';

export interface ListOpsMetricsInput {
  metric?: string;
  from?: Date;
  to?: Date;
  /** Cursor opaco devolvido pela página anterior; ausente pede a primeira. */
  cursor?: string;
}

export interface ListOpsMetricsOutput {
  /** Janela resolvida: o cliente repete `from`/`to` junto do cursor para seguir na mesma janela. */
  window: { from: Date; to: Date };
  samples: OpsMetricSample[];
  nextCursor: string | null;
  /** Estado atual dos workers vivos (`worker_heartbeats`), independente da página. */
  workers: WorkerHeartbeat[];
}

/** Página decidida pelo servidor (cursor opaco): o front nunca envia `limit`/`offset`. */
export const OPS_METRICS_PAGE_SIZE = 500;
/** Janela padrão sem `from`. */
export const OPS_METRICS_DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Maior janela aceita: a retenção da tabela (7 dias). */
export const OPS_METRICS_MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Leitura super admin das métricas de recursos (MQ-25). Só tabelas locais (`ops_metrics_samples`,
 * `worker_heartbeats`): nunca chama a Render na requisição. Dado de plataforma, sem tenant.
 *
 * O escopo do cursor amarra métrica e janela resolvida: cursor de outra janela recomeça do início.
 * Ordem `at` desc com `to` fixo: amostras novas (`at` > `to`) e a retenção (apaga as mais antigas,
 * no fim da lista) não deslocam as páginas já lidas.
 */
export class ListOpsMetricsUseCase {
  constructor(
    private readonly samples: IOpsMetricsSampleReader,
    private readonly heartbeats: Pick<IWorkerHeartbeatRepository, 'listAlive'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: ListOpsMetricsInput): Promise<ListOpsMetricsOutput> {
    const { from, to } = resolveOpsMetricsWindow(input, this.now());

    const metric = input.metric ?? null;
    const scope = `ops-metrics:${metric ?? '*'}:${from.toISOString()}:${to.toISOString()}`;
    const offset = readCursor(input.cursor, scope) ?? 0;

    const [rows, workers] = await Promise.all([
      this.samples.listPage({ metric, from, to }, offset, OPS_METRICS_PAGE_SIZE + 1),
      this.heartbeats.listAlive(WORKER_ALIVE_MS),
    ]);
    const hasMore = rows.length > OPS_METRICS_PAGE_SIZE;
    const samples = hasMore ? rows.slice(0, OPS_METRICS_PAGE_SIZE) : rows;
    const nextCursor = hasMore ? createCursor(scope, offset + OPS_METRICS_PAGE_SIZE) : null;
    return { window: { from, to }, samples, nextCursor, workers };
  }
}

/**
 * Janela das leituras super admin: `to` padrão = agora (sem ms), `from` padrão = `to` − 24 h.
 * `from > to` ou janela acima de 7 dias (a retenção) → `ValidationError` (400).
 */
export function resolveOpsMetricsWindow(input: { from?: Date; to?: Date }, now: Date): { from: Date; to: Date } {
  const to = input.to ?? truncateToSecond(now);
  const from = input.from ?? new Date(to.getTime() - OPS_METRICS_DEFAULT_WINDOW_MS);
  if (from.getTime() > to.getTime()) throw new ValidationError('`from` must be before `to`');
  if (to.getTime() - from.getTime() > OPS_METRICS_MAX_WINDOW_MS) {
    throw new ValidationError('Window must not exceed 7 days');
  }
  return { from, to };
}

/** `to` padrão sem milissegundos: o ISO devolvido volta igual no próximo pedido. */
function truncateToSecond(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 1000) * 1000);
}
