import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import type { SessionStatus } from '../../domain/enums/SessionStatus';
import { normalizeInternationalPhone } from '../../domain/services/normalizeInternationalPhone';
import { markConnectRequested } from '../services/markConnectRequested';
import {
  SessionAlreadyConnectedError,
  SessionNotFoundError,
  SessionPhoneInvalidError,
} from '../../../../shared/errors/internal/SessionErrors';
import { EngineOperationUnsupportedError } from '../../../../shared/errors/internal/MessagingErrors';

export interface LoginStepOutput {
  sessionId: string;
  status: SessionStatus;
}

/**
 * Login por código enviado ao app do usuário (hoje só Telegram): o operador informa o telefone,
 * recebe o código no próprio app e digita no painel; conta com verificação em duas etapas
 * pede a senha em seguida. Nunca há número da plataforma envolvido.
 */
abstract class SessionLoginStepUseCase {
  constructor(
    protected readonly sessionRepo: ISessionRepository,
    protected readonly auditRepo: IAuditLogRepository,
    protected readonly engine: IMessagingEngine,
  ) {}

  protected async loadPending(sessionId: string, tenantId: string, operation: string) {
    const session = await this.sessionRepo.findById(sessionId, tenantId);
    if (!session) throw new SessionNotFoundError(sessionId);
    if (!session.isTelegram()) throw new EngineOperationUnsupportedError(session.engine, operation);
    if (session.isConnected()) throw new SessionAlreadyConnectedError(sessionId);
    return session;
  }
}

export class RequestSessionLoginCodeUseCase extends SessionLoginStepUseCase {
  async execute(input: { sessionId: string; tenantId: string; userId: string; phone?: string | null }): Promise<LoginStepOutput> {
    const session = await this.loadPending(input.sessionId, input.tenantId, 'requestLoginCode');
    const fromBody = input.phone != null && input.phone.trim() !== '';
    const phone = normalizeInternationalPhone(fromBody ? input.phone : session.declaredPhone);
    if (!phone) throw new SessionPhoneInvalidError(fromBody ? 'phone' : 'declaredPhone');

    await markConnectRequested(this.sessionRepo, input.sessionId, input.tenantId);

    const { status } = await this.engine.requestLoginCode({ sessionId: input.sessionId, tenantId: input.tenantId, phone });
    await this.auditRepo.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: 'SESSION_CONNECTED',
      meta: { sessionId: input.sessionId, action: 'login_code_requested' },
    });
    return { sessionId: input.sessionId, status };
  }
}

export class SubmitSessionLoginCodeUseCase extends SessionLoginStepUseCase {
  async execute(input: { sessionId: string; tenantId: string; code: string }): Promise<LoginStepOutput> {
    await this.loadPending(input.sessionId, input.tenantId, 'submitLoginCode');
    await markConnectRequested(this.sessionRepo, input.sessionId, input.tenantId);
    const { status } = await this.engine.submitLoginCode({
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      code: input.code.replace(/\D/g, ''),
    });
    return { sessionId: input.sessionId, status };
  }
}

export class SubmitSessionLoginPasswordUseCase extends SessionLoginStepUseCase {
  async execute(input: { sessionId: string; tenantId: string; password: string }): Promise<LoginStepOutput> {
    await this.loadPending(input.sessionId, input.tenantId, 'submitLoginPassword');
    await markConnectRequested(this.sessionRepo, input.sessionId, input.tenantId);
    const { status } = await this.engine.submitLoginPassword({
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      password: input.password,
    });
    return { sessionId: input.sessionId, status };
  }
}
