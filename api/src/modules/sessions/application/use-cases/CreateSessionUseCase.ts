import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type { Session } from '../../domain/entities/Session';
import { normalizeBrazilPhone } from '../../domain/services/normalizeBrazilPhone';
import { SessionPhoneInvalidError } from '../../../../shared/errors/internal/SessionErrors';

export interface CreateSessionInput {
  tenantId: string;
  userId: string;
  name: string;
  engine?: string;
  /** Número do WhatsApp que será conectado; opcional, validado e normalizado aqui. */
  declaredPhone?: string | null;
}

export class CreateSessionUseCase {
  constructor(
    private readonly sessionRepo: ISessionRepository,
    private readonly auditRepo: IAuditLogRepository,
  ) {}

  async execute(input: CreateSessionInput): Promise<Session> {
    let declaredPhone: string | null = null;
    if (input.declaredPhone != null && input.declaredPhone.trim() !== '') {
      declaredPhone = normalizeBrazilPhone(input.declaredPhone);
      if (!declaredPhone) throw new SessionPhoneInvalidError('declaredPhone');
    }

    const session = await this.sessionRepo.create({
      tenantId: input.tenantId,
      name: input.name,
      engine: input.engine ?? 'baileys',
      declaredPhone,
    });

    await this.auditRepo.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: 'SESSION_CREATED',
      meta: {
        sessionId: session.id,
        name: session.name,
        engine: session.engine,
        hasDeclaredPhone: declaredPhone !== null,
      },
    });

    return session;
  }
}
