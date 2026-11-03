import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type { Session } from '../../domain/entities/Session';
import { normalizeBrazilPhone } from '../../domain/services/normalizeBrazilPhone';
import { SessionPhoneInvalidError } from '../../../../shared/errors/internal/SessionErrors';
import type { IEntitlementReader } from '../../../tenants/domain/contracts/IEntitlementReader';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';

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
    private readonly entitlements: IEntitlementReader,
  ) {}

  async execute(input: CreateSessionInput): Promise<Session> {
    let declaredPhone: string | null = null;
    if (input.declaredPhone != null && input.declaredPhone.trim() !== '') {
      declaredPhone = normalizeBrazilPhone(input.declaredPhone);
      if (!declaredPhone) throw new SessionPhoneInvalidError('declaredPhone');
    }

    const data = {
      tenantId: input.tenantId,
      name: input.name,
      engine: input.engine ?? 'baileys',
      declaredPhone,
    };
    // Limite do plano; entitlement ausente = ilimitado (tenant sem plano sincronizado não regride).
    // Contagem + criação atômicas no repositório (lock por tenant): criações simultâneas não passam do limite.
    const key = ENTITLEMENT_KEYS.WHATSAPP_SESSIONS;
    const limit = await this.entitlements.getNumber(input.tenantId, key);
    const session = limit === null
      ? await this.sessionRepo.create(data)
      : await this.sessionRepo.createWithinLimit(data, { key, limit });

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
