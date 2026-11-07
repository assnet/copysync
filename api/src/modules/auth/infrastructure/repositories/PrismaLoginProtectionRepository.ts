import { prisma } from '../../../../shared/database/prisma.client';
import type {
  ILoginCodeRepository,
  ILoginEventRepository,
  LoginCodeRecord,
  LoginEventInput,
} from '../../domain/contracts/ILoginProtectionRepository';

const RESET_EVENTS = ['LOGIN_OK', 'LOGIN_CODE_VERIFIED'];
/** Teto de linhas lidas por consulta: as regras só olham poucas falhas. */
const MAX_ROWS = 50;

/** Eventos de login (tabela `login_events`, índices email+data e ip+data). Não é tenant-aware: login é global. */
export class PrismaLoginEventRepository implements ILoginEventRepository {
  async record(input: LoginEventInput): Promise<void> {
    await prisma.loginEvent.create({
      data: {
        type: input.type,
        email: input.email,
        ip: input.ip,
        userId: input.type === 'LOGIN_FAILED' ? null : input.userId,
        userAgent: input.userAgent,
      },
    });
  }

  async emailFailuresSince(email: string, since: Date, afterReset: boolean): Promise<Date[]> {
    let from = since;
    if (afterReset) {
      const reset = await prisma.loginEvent.findFirst({
        where: { email, type: { in: RESET_EVENTS }, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      if (reset) from = reset.createdAt;
    }
    const rows = await prisma.loginEvent.findMany({
      where: { email, type: 'LOGIN_FAILED', createdAt: { gt: from } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
      take: MAX_ROWS,
    });
    return rows.map((r) => r.createdAt);
  }

  async ipFailuresSince(ip: string, since: Date): Promise<Date[]> {
    const rows = await prisma.loginEvent.findMany({
      where: { ip, type: 'LOGIN_FAILED', createdAt: { gte: since } },
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

/** Códigos do login suspeito (tabela `login_codes`): só o hash; tentativas e consumo atômicos. */
export class PrismaLoginCodeRepository implements ILoginCodeRepository {
  async createPending(input: { userId: string; codeHash: string; expiresAt: Date }): Promise<LoginCodeRecord> {
    return prisma.loginCode.create({ data: input });
  }

  async markSent(id: string, userId: string, sentAt: Date): Promise<void> {
    await prisma.$transaction([
      prisma.loginCode.updateMany({
        where: { userId, id: { not: id }, consumedAt: null, invalidatedAt: null },
        data: { invalidatedAt: sentAt },
      }),
      prisma.loginCode.update({ where: { id }, data: { sentAt } }),
    ]);
  }

  async deletePending(id: string): Promise<void> {
    await prisma.loginCode.deleteMany({ where: { id, sentAt: null } });
  }

  async createdSince(userId: string, since: Date): Promise<Date[]> {
    const rows = await prisma.loginCode.findMany({
      where: { userId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
      take: MAX_ROWS,
    });
    return rows.map((r) => r.createdAt);
  }

  async findLatestOpen(userId: string): Promise<LoginCodeRecord | null> {
    return prisma.loginCode.findFirst({
      where: { userId, sentAt: { not: null }, consumedAt: null, invalidatedAt: null },
      orderBy: { sentAt: 'desc' },
    });
  }

  async registerAttempt(id: string, maxAttempts: number): Promise<number | null> {
    const rows = await prisma.$queryRaw<{ attempts: number }[]>`
      UPDATE "login_codes" SET "attempts" = "attempts" + 1
      WHERE "id" = ${id} AND "attempts" < ${maxAttempts} AND "consumedAt" IS NULL AND "invalidatedAt" IS NULL
      RETURNING "attempts"`;
    return rows[0]?.attempts ?? null;
  }

  async consume(id: string, at: Date): Promise<boolean> {
    const r = await prisma.loginCode.updateMany({ where: { id, consumedAt: null, invalidatedAt: null }, data: { consumedAt: at } });
    return r.count === 1;
  }
}
