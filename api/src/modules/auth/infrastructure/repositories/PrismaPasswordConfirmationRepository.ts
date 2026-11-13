import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../../../shared/database/prisma.client';
import type { TransactionClient } from '../../../../shared/database/UnitOfWork';
import type {
  IPasswordConfirmationRepository,
  ReservePasswordConfirmationInput,
} from '../../domain/contracts/IPasswordConfirmationRepository';

type Db = PrismaClient | TransactionClient;

/** `password_confirmation_attempts`. Toda consulta filtra `userId` (dado do usuário, sem tenant). */
export class PrismaPasswordConfirmationRepository implements IPasswordConfirmationRepository {
  constructor(private readonly db: Db = prisma) {}

  /** `pg_advisory_xact_lock` por usuário numa transação curta (solta no commit). */
  async withUserLock<T>(userId: string, fn: (repo: IPasswordConfirmationRepository) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`password-confirmation:${userId}`}, 0))`;
      return fn(new PrismaPasswordConfirmationRepository(tx));
    }, { timeout: 10_000 });
  }

  async failuresSince(userId: string, since: Date): Promise<Date[]> {
    const rows = await this.db.passwordConfirmationAttempt.findMany({
      where: { userId, success: false, createdAt: { gte: since } },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => r.createdAt);
  }

  async reserve(input: ReservePasswordConfirmationInput): Promise<string> {
    const row = await this.db.passwordConfirmationAttempt.create({
      data: { userId: input.userId, action: input.action, success: false, createdAt: input.createdAt },
      select: { id: true },
    });
    return row.id;
  }

  async markSucceeded(id: string): Promise<void> {
    await this.db.passwordConfirmationAttempt.updateMany({ where: { id }, data: { success: true } });
  }

  async discard(id: string): Promise<void> {
    await this.db.passwordConfirmationAttempt.deleteMany({ where: { id, success: false } });
  }

  async pruneUser(userId: string, before: Date): Promise<void> {
    await this.db.passwordConfirmationAttempt.deleteMany({ where: { userId, createdAt: { lt: before } } });
  }
}
