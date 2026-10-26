import { PrismaClient } from '@prisma/client';
import type { ITXClientDenyList } from '@prisma/client/runtime/library';
import { prisma } from './prisma.client';
import { logger } from '../logger/logger';

export type TransactionClient = Omit<PrismaClient, ITXClientDenyList>;

export interface IUnitOfWork {
  runInTransaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T>;
  afterCommit(fn: () => Promise<void>): void;
}

export class UnitOfWork implements IUnitOfWork {
  private callbacks: Array<() => Promise<void>> = [];

  afterCommit(fn: () => Promise<void>): void {
    this.callbacks.push(fn);
  }

  async runInTransaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
    this.callbacks = [];
    const result = await prisma.$transaction(async (tx) => fn(tx));

    for (const cb of this.callbacks) {
      try {
        await cb();
      } catch (err) {
        logger.error({ err }, 'afterCommit callback failed');
      }
    }

    return result;
  }
}
