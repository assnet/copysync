import type { Prisma, PrismaClient } from '@prisma/client';
import { UsageMetricsReadUnavailableError } from '../../../../shared/errors/internal/UsageMetricsErrors';
import type { IUsageReadGate, UsageReadBudget } from '../../domain/contracts/IUsageReadGate';
import { isStatementTimeout } from './infraCostReadTimeout';

/** Orçamento do pedido inteiro de uso dos recursos (design §4.1). */
export const USAGE_READ_BUDGET_MS = 2000;

/** Só o que a leitura usa do Prisma (o teste passa um dublê). */
export type UsageReadPrisma = Pick<PrismaClient, '$transaction' | '$executeRawUnsafe' | '$queryRaw'>;

/** Orçamento com relógio injetável; conta desde a criação (o pedido cria logo antes da primeira leitura). */
export function createReadBudget(totalMs = USAGE_READ_BUDGET_MS, clock: () => number = Date.now): UsageReadBudget {
  const deadline = clock() + totalMs;
  const pending = new Set<Promise<unknown>>();
  return {
    remainingMs: () => deadline - clock(),
    track(instruction) {
      const done = instruction.then(
        () => undefined,
        () => undefined,
      );
      pending.add(done);
      void done.then(() => pending.delete(done));
    },
    async settled() {
      while (pending.size > 0) await Promise.all([...pending]);
    },
  };
}

/** `statement_timeout` estourado (SQLSTATE 57014) vira 503; o resto propaga. */
export function translateUsageReadError(err: unknown): unknown {
  return isStatementTimeout(err) ? new UsageMetricsReadUnavailableError() : err;
}

/**
 * Uma ida ao banco dentro do orçamento: transação própria com `SET LOCAL statement_timeout` igual ao que
 * resta (ms inteiro, calculado agora). Menos de 1 ms não vai ao banco (`0` desligaria o limite). A leitura
 * corre contra um temporizador do mesmo tamanho, que cobre a espera por conexão do pool; a instrução
 * abandonada fica registrada no orçamento até terminar.
 */
export async function runWithinBudget<T>(budget: UsageReadBudget, prisma: UsageReadPrisma, query: Prisma.Sql): Promise<T[]> {
  const ms = Math.floor(budget.remainingMs());
  if (ms < 1) throw new UsageMetricsReadUnavailableError();

  const instruction = prisma
    .$transaction([prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = ${ms}`), prisma.$queryRaw<T[]>(query)])
    .then((results) => results[1] as T[]);
  budget.track(instruction);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new UsageMetricsReadUnavailableError()), ms);
  });
  try {
    return await Promise.race([instruction, expired]);
  } catch (err) {
    throw translateUsageReadError(err);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Semáforo de 1 vaga por processo: limitador de concorrência local, sem dado de negócio (design §9).
 * Ocupada = 503 na hora. A vaga volta só quando todas as instruções do pedido terminam (inclusive a órfã).
 */
export class ProcessUsageReadGate implements IUsageReadGate {
  private busy = false;

  constructor(private readonly newBudget: () => UsageReadBudget = () => createReadBudget()) {}

  async runExclusive<T>(read: (budget: UsageReadBudget) => Promise<T>): Promise<T> {
    if (this.busy) throw new UsageMetricsReadUnavailableError();
    this.busy = true;
    const budget = this.newBudget();
    try {
      return await read(budget);
    } finally {
      void budget.settled().then(() => {
        this.busy = false;
      });
    }
  }
}

/** Instância única do processo (não vale entre réplicas; reinício a zera sem perda). */
export const usageReadGate: IUsageReadGate = new ProcessUsageReadGate();
