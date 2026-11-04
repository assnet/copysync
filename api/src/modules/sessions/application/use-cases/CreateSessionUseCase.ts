import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type { Session } from '../../domain/entities/Session';
import { normalizeBrazilPhone } from '../../domain/services/normalizeBrazilPhone';
import { normalizeInternationalPhone } from '../../domain/services/normalizeInternationalPhone';
import { SessionPhoneInvalidError } from '../../../../shared/errors/internal/SessionErrors';
import { EngineDisabledError } from '../../../../shared/errors/internal/MessagingErrors';
import type { IEntitlementReader } from '../../../tenants/domain/contracts/IEntitlementReader';
import { channelLimitKey } from '../../../tenants/domain/channelLimits';
import { isSessionEngine } from '../../domain/sessionEngines';

export interface CreateSessionInput {
  tenantId: string;
  userId: string;
  name: string;
  engine?: string;
  /** Número que será conectado; opcional, validado e normalizado aqui conforme o canal. */
  declaredPhone?: string | null;
}

export class CreateSessionUseCase {
  constructor(
    private readonly sessionRepo: ISessionRepository,
    private readonly auditRepo: IAuditLogRepository,
    private readonly entitlements: IEntitlementReader,
    /** Engines ligadas neste processo; a que não estiver aqui responde ENGINE_DISABLED. */
    private readonly enabledEngines: ReadonlySet<string> = new Set(['baileys']),
  ) {}

  async execute(input: CreateSessionInput): Promise<Session> {
    const engine = input.engine ?? 'baileys';
    if (!isSessionEngine(engine) || !this.enabledEngines.has(engine)) throw new EngineDisabledError(engine);

    let declaredPhone: string | null = null;
    if (input.declaredPhone != null && input.declaredPhone.trim() !== '') {
      declaredPhone = engine === 'telegram'
        ? normalizeInternationalPhone(input.declaredPhone)
        : normalizeBrazilPhone(input.declaredPhone);
      if (!declaredPhone) throw new SessionPhoneInvalidError('declaredPhone');
    }

    const data = { tenantId: input.tenantId, name: input.name, engine, declaredPhone };
    // Limite do plano por canal; entitlement ausente = ilimitado (tenant sem plano sincronizado não regride).
    // Contagem + criação atômicas no repositório (lock por tenant): criações simultâneas não passam do limite.
    const key = channelLimitKey('sessions', engine);
    const limit = await this.entitlements.getNumber(input.tenantId, key);
    const session = limit === null
      ? await this.sessionRepo.create(data)
      : await this.sessionRepo.createWithinLimit(data, { key, limit, engine });

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
