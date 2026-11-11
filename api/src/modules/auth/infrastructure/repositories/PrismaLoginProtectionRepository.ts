import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../../../shared/database/prisma.client';
import type {
  FailureQuery,
  ILoginCodeRepository,
  ILoginEventRepository,
  LoginCodeRecord,
  LoginEventInput,
} from '../../domain/contracts/ILoginProtectionRepository';

const RESET_EVENTS = ['LOGIN_OK', 'LOGIN_CODE_VERIFIED', 'PASSWORD_RESET_OK'];
/** Teto de linhas lidas por consulta: as regras só olham poucas falhas. */
const MAX_ROWS = 50;

const failureTypes = (q?: FailureQuery) => (q?.includePending ? { in: ['LOGIN_FAILED', 'LOGIN_ATTEMPT'] } : 'LOGIN_FAILED');
const notSelf = (q?: FailureQuery) => (q?.excludeId ? { id: { not: q.excludeId } } : {});

/** Eventos de login (tabela `login_events`, índices email+data e ip+data). Não é tenant-aware: login é global. */
export class PrismaLoginEventRepository implements ILoginEventRepository {
  async record(input: LoginEventInput): Promise<string> {
    const row = await prisma.loginEvent.create({
      data: {
        type: input.type,
        email: input.email,
        ip: input.ip,
        userId: RESET_EVENTS.includes(input.type) ? input.userId : null,
        userAgent: input.userAgent,
      },
      select: { id: true },
    });
    return row.id;
  }

  async markAttemptFailed(id: string): Promise<void> {
    await prisma.loginEvent.updateMany({ where: { id, type: 'LOGIN_ATTEMPT' }, data: { type: 'LOGIN_FAILED' } });
  }

  async discardAttempt(id: string): Promise<void> {
    await prisma.loginEvent.deleteMany({ where: { id, type: 'LOGIN_ATTEMPT' } });
  }

  async emailFailuresSince(email: string, since: Date, afterReset: boolean, q?: FailureQuery): Promise<Date[]> {
    let from = since;
    let strict = false;
    if (afterReset) {
      const reset = await prisma.loginEvent.findFirst({
        where: { email, type: { in: RESET_EVENTS }, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      if (reset) { from = reset.createdAt; strict = true; }
    }
    const rows = await prisma.loginEvent.findMany({
      where: { email, type: failureTypes(q), createdAt: strict ? { gt: from } : { gte: from }, ...notSelf(q) },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
      take: MAX_ROWS,
    });
    return rows.map((r) => r.createdAt);
  }

  async ipFailuresSince(ip: string, since: Date, q?: FailureQuery): Promise<Date[]> {
    const rows = await prisma.loginEvent.findMany({
      where: { ip, type: failureTypes(q), createdAt: { gte: since }, ...notSelf(q) },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
      take: MAX_ROWS,
    });
    return rows.map((r) => r.createdAt);
  }

  async prune(eventsBefore: Date, codesBefore: Date): Promise<void> {
    await prisma.loginEvent.deleteMany({ where: { createdAt: { lt: eventsBefore } } });
    await prisma.loginCode.deleteMany({ where: { createdAt: { lt: codesBefore } } });
  }
}

type Db = PrismaClient | Prisma.TransactionClient;

/** Códigos do login suspeito (tabela `login_codes`): só o hash; tentativas e consumo atômicos. */
export class PrismaLoginCodeRepository implements ILoginCodeRepository {
  constructor(private readonly db: Db = prisma) {}

  /** `pg_advisory_xact_lock` por usuário dentro de uma transação curta (solta no commit). */
  async withUserLock<T>(userId: string, fn: (repo: ILoginCodeRepository) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`login-code:${userId}`}, 0))`;
      return fn(new PrismaLoginCodeRepository(tx));
    }, { timeout: 10_000 });
  }

  async createPending(input: { userId: string; codeHash: string; expiresAt: Date }): Promise<LoginCodeRecord> {
    return this.db.loginCode.create({ data: input });
  }

  async markSent(id: string, userId: string, sentAt: Date): Promise<void> {
    await this.db.loginCode.updateMany({
      where: { userId, id: { not: id }, sentAt: { not: null, lte: sentAt }, consumedAt: null, invalidatedAt: null },
      data: { invalidatedAt: sentAt },
    });
    await this.db.loginCode.update({ where: { id }, data: { sentAt } });
  }

  async deletePending(id: string): Promise<void> {
    await this.db.loginCode.deleteMany({ where: { id, sentAt: null } });
  }

  async createdSince(userId: string, since: Date): Promise<Date[]> {
    const rows = await this.db.loginCode.findMany({
      where: { userId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
      take: MAX_ROWS,
    });
    return rows.map((r) => r.createdAt);
  }

  async exhaustedSince(userId: string, since: Date, maxAttempts: number): Promise<Date[]> {
    const rows = await this.db.loginCode.findMany({
      where: { userId, createdAt: { gte: since }, attempts: { gte: maxAttempts } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
      take: MAX_ROWS,
    });
    return rows.map((r) => r.createdAt);
  }

  async findLatestOpen(userId: string): Promise<LoginCodeRecord | null> {
    return this.db.loginCode.findFirst({
      where: { userId, sentAt: { not: null }, consumedAt: null, invalidatedAt: null },
      orderBy: { sentAt: 'desc' },
    });
  }

  async registerAttempt(id: string, maxAttempts: number): Promise<number | null> {
    const rows = await this.db.$queryRaw<{ attempts: number }[]>`
      UPDATE "login_codes" SET "attempts" = "attempts" + 1
      WHERE "id" = ${id} AND "attempts" < ${maxAttempts} AND "consumedAt" IS NULL AND "invalidatedAt" IS NULL
      RETURNING "attempts"`;
    return rows[0]?.attempts ?? null;
  }

  async consume(id: string, at: Date): Promise<boolean> {
    const r = await this.db.loginCode.updateMany({ where: { id, consumedAt: null, invalidatedAt: null }, data: { consumedAt: at } });
    return r.count === 1;
  }
}
