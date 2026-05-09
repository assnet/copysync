import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type { Session } from '../../domain/entities/Session';

export interface CreateSessionInput {
  tenantId: string;
  userId: string;
  name: string;
  engine?: string;
}

export class CreateSessionUseCase {
  constructor(
    private readonly sessionRepo: ISessionRepository,
    private readonly auditRepo: IAuditLogRepository,
  ) {}

  async execute(input: CreateSessionInput): Promise<Session> {
    const session = await this.sessionRepo.create({
      tenantId: input.tenantId,
      name: input.name,
      engine: input.engine ?? 'baileys',
    });

    await this.auditRepo.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: 'SESSION_CREATED',
      meta: { sessionId: session.id, name: session.name, engine: session.engine },
    });

    return session;
  }
}
