import { prisma } from '../../../../shared/database/prisma.client';
import type { IPasswordResetRepository, PasswordResetRecord } from '../../domain/contracts/IPasswordResetRepository';

/** Teto de linhas lidas por consulta: a regra só olha poucos pedidos. */
const MAX_ROWS = 50;

/** Pedidos de redefinição (tabela `password_reset_requests`). Não é tenant-aware: a conta é global. */
export class PrismaPasswordResetRepository implements IPasswordResetRepository {
  async record(input: { email: string; ip: string | null }): Promise<string> {
    const row = await prisma.passwordResetRequest.create({ data: { email: input.email, ip: input.ip }, select: { id: true } });
    return row.id;
  }

  async discard(id: string): Promise<void> {
    await prisma.passwordResetRequest.deleteMany({ where: { id, tokenHash: null } });
  }

  async emailRequestsSince(email: string, since: Date, excludeId: string): Promise<Date[]> {
    return this.datesWhere({ email, createdAt: { gte: since }, id: { not: excludeId } });
  }

  async ipRequestsSince(ip: string, since: Date, excludeId: string): Promise<Date[]> {
    return this.datesWhere({ ip, createdAt: { gte: since }, id: { not: excludeId } });
  }

  async attachToken(id: string, input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void> {
    await prisma.passwordResetRequest.update({ where: { id }, data: input });
  }

  async findByTokenHash(tokenHash: string): Promise<PasswordResetRecord | null> {
    const row = await prisma.passwordResetRequest.findUnique({ where: { tokenHash } });
    if (!row) return null;
    const { id, email, userId, expiresAt, usedAt, invalidatedAt } = row;
    return { id, email, userId, expiresAt, usedAt, invalidatedAt };
  }

  async consumeAndSetPassword(input: { id: string; userId: string; passwordHash: string; now: Date }): Promise<boolean> {
    const { id, userId, passwordHash, now } = input;
    return prisma.$transaction(async (tx) => {
      // Trava a linha do usuário primeiro: dois links DIFERENTES da mesma conta usados ao mesmo tempo
      // ficam em fila (sem isso cada transação invalida o link da outra e o Postgres aborta por deadlock).
      await tx.$queryRaw`SELECT 1 FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
      // Consumo atômico: dois envios paralelos do mesmo link, só um passa.
      const consumed = await tx.passwordResetRequest.updateMany({
        where: { id, userId, usedAt: null, invalidatedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) return false;
      await tx.user.update({ where: { id: userId }, data: { passwordHash, passwordSetAt: now, mustChangePassword: false } });
      await tx.passwordResetRequest.updateMany({
        where: { userId, id: { not: id }, usedAt: null, invalidatedAt: null },
        data: { invalidatedAt: now },
      });
      // Encerra tudo que autentica a conta: painel (refresh tokens) e extensão do navegador.
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
      await tx.extensionSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
      return true;
    });
  }

  async prune(before: Date): Promise<void> {
    await prisma.passwordResetRequest.deleteMany({ where: { createdAt: { lt: before } } });
  }

  private async datesWhere(where: object): Promise<Date[]> {
    const rows = await prisma.passwordResetRequest.findMany({
      where, orderBy: { createdAt: 'desc' }, select: { createdAt: true }, take: MAX_ROWS,
    });
    return rows.map((r) => r.createdAt);
  }
}
