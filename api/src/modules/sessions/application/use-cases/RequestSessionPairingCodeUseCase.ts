import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type { IMessagingEngine } from '../../../../modules/messaging/domain/contracts/IMessagingEngine';
import type { SessionStatus } from '../../domain/enums/SessionStatus';
import { normalizeBrazilPhone } from '../../domain/services/normalizeBrazilPhone';
import {
  SessionNotFoundError,
  SessionAlreadyConnectedError,
  SessionPhoneInvalidError,
} from '../../../../shared/errors/internal/SessionErrors';

export interface RequestSessionPairingCodeInput {
  sessionId: string;
  tenantId: string;
  userId: string;
  /** Número a parear; sem ele vale o `declaredPhone` da sessão. */
  phone?: string | null;
}

export interface RequestSessionPairingCodeOutput {
  sessionId: string;
  status: SessionStatus;
  /** `null` enquanto o socket sobe — o painel consulta GET /:id/pairing-code. */
  pairingCode: string | null;
}

/** Status em que ainda não há socket ativo: o pedido abre a conexão. */
const IDLE_STATUSES: SessionStatus[] = ['PENDING', 'DISCONNECTED', 'FAILED', 'LOGGED_OUT'];

/**
 * Conectar com código de pareamento (alternativa ao QR): o operador digita o código de
 * 8 caracteres em WhatsApp → Aparelhos conectados → Conectar com número de telefone.
 */
export class RequestSessionPairingCodeUseCase {
  constructor(
    private readonly sessionRepo: ISessionRepository,
    private readonly auditRepo: IAuditLogRepository,
    private readonly engine: IMessagingEngine,
  ) {}

  async execute(input: RequestSessionPairingCodeInput): Promise<RequestSessionPairingCodeOutput> {
    const session = await this.sessionRepo.findById(input.sessionId, input.tenantId);
    if (!session) throw new SessionNotFoundError(input.sessionId);
    if (session.isConnected()) throw new SessionAlreadyConnectedError(input.sessionId);

    const fromBody = input.phone != null && input.phone.trim() !== '';
    const phone = normalizeBrazilPhone(fromBody ? input.phone : session.declaredPhone);
    if (!phone) throw new SessionPhoneInvalidError(fromBody ? 'phone' : 'declaredPhone');

    const previous: SessionStatus = session.status ?? 'FAILED';
    const markedConnecting = IDLE_STATUSES.includes(previous);
    if (markedConnecting) {
      // Mesmo motivo do connect: um crash não deixa a sessão parada em PENDING.
      await this.sessionRepo.updateStatus(input.sessionId, input.tenantId, { status: 'CONNECTING' });
    }

    await this.auditRepo.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: 'SESSION_CONNECTED',
      meta: { sessionId: input.sessionId, action: 'pairing_code_requested' },
    });

    let pairingCode: string | null;
    try {
      ({ pairingCode } = await this.engine.requestPairingCode({
        sessionId: input.sessionId,
        tenantId: input.tenantId,
        phone,
      }));
    } catch (err) {
      // Motor falhou: não deixa a sessão presa em CONNECTING; o erro original sobe
      if (markedConnecting) {
        await this.sessionRepo
          .updateStatus(input.sessionId, input.tenantId, { status: previous })
          .catch(() => undefined);
      }
      throw err;
    }

    return {
      sessionId: input.sessionId,
      status: pairingCode ? 'AWAITING_PAIRING' : 'CONNECTING',
      pairingCode,
    };
  }
}
