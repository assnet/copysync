import { Prisma } from '@prisma/client';
import { InfraCostReadUnavailableError } from '../../../../shared/errors/internal/InfraCostErrors';
import type { IWorkerCapacityReader, WorkerCapacityPlanRow } from '../../../sessions/domain/contracts/IWorkerCapacityReader';

const STATEMENT_TIMEOUT_SQLSTATE = '57014';
const STATEMENT_TIMEOUT_TEXT = /canceling statement due to statement timeout/i;

/**
 * `statement_timeout` estourado. No Prisma 5 o `$queryRaw` chega como `P2010` com `meta.code` = SQLSTATE;
 * em outros caminhos só a mensagem do Postgres identifica (desconhecido/Rust).
 */
export function isStatementTimeout(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = err.meta as { code?: unknown } | undefined;
    if (meta?.code === STATEMENT_TIMEOUT_SQLSTATE) return true;
  }
  if (err instanceof Error) return err.message.includes(STATEMENT_TIMEOUT_SQLSTATE) || STATEMENT_TIMEOUT_TEXT.test(err.message);
  return false;
}

/** Roda a leitura do resumo de custos; timeout → 503 `INFRA_COST_READ_UNAVAILABLE` (design §6). Resto propaga. */
export async function translateInfraCostReadTimeout<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if (isStatementTimeout(err)) throw new InfraCostReadUnavailableError();
    throw err;
  }
}

/**
 * Capacidade por plano só para o resumo de custos: mesma leitura, timeout vira 503. Os outros
 * consumidores de `PrismaWorkerCapacityReader` (capacidade dos workers) seguem como estão.
 */
export class InfraCostCapacityReader implements IWorkerCapacityReader {
  constructor(private readonly inner: IWorkerCapacityReader) {}

  readByPlan(): Promise<WorkerCapacityPlanRow[]> {
    return translateInfraCostReadTimeout(() => this.inner.readByPlan());
  }
}
