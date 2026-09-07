import type { Session } from '../../domain/entities/Session';
import type { GetSessionStatusOutput } from '../../application/use-cases/GetSessionStatusUseCase';
import type { ConnectSessionOutput } from '../../application/use-cases/ConnectSessionUseCase';
import type { DisconnectSessionOutput } from '../../application/use-cases/DisconnectSessionUseCase';
import type { LogoutSessionOutput } from '../../application/use-cases/LogoutSessionUseCase';
import type { GetSessionQrOutput } from '../../application/use-cases/GetSessionQrUseCase';
import type { GetSessionPairingCodeOutput } from '../../application/use-cases/GetSessionPairingCodeUseCase';

export class SessionPresenter {
  static toSessionItem(session: Session, avatarUrl: string | null = null) {
    return {
      avatarUrl,
      id: session.id,
      tenantId: session.tenantId,
      name: session.name,
      engine: session.engine,
      phone: session.phone,
      externalRef: session.externalRef,
      status: session.status,
      lastConnectedAt: session.lastConnectedAt?.toISOString() ?? null,
      lastDisconnectedAt: session.lastDisconnectedAt?.toISOString() ?? null,
      lastSeenAt: session.lastSeenAt?.toISOString() ?? null,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    };
  }

  static toSessionList(items: Array<{ session: Session; avatarUrl: string | null }>) {
    return {
      sessions: items.map((item) => SessionPresenter.toSessionItem(item.session, item.avatarUrl)),
      total: items.length,
    };
  }

  static toSessionStatus(output: GetSessionStatusOutput) {
    return {
      sessionId: output.sessionId,
      status: output.status,
      phone: output.phone,
      lastConnectedAt: output.lastConnectedAt?.toISOString() ?? null,
      lastDisconnectedAt: output.lastDisconnectedAt?.toISOString() ?? null,
    };
  }

  static toConnectResult(output: ConnectSessionOutput) {
    return {
      sessionId: output.sessionId,
      status: output.status,
      ...(output.qrCode && { qrCode: output.qrCode }),
      ...(output.pairingCode && { pairingCode: output.pairingCode }),
    };
  }

  static toActionResult(output: DisconnectSessionOutput | LogoutSessionOutput) {
    return {
      sessionId: output.sessionId,
      status: output.status,
    };
  }

  static toQrResult(output: GetSessionQrOutput) {
    return {
      sessionId: output.sessionId,
      qrCode: output.qrCode,
    };
  }

  static toPairingCodeResult(output: GetSessionPairingCodeOutput) {
    return {
      sessionId: output.sessionId,
      pairingCode: output.pairingCode,
    };
  }
}
