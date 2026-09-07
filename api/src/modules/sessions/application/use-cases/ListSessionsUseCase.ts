import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { Session } from '../../domain/entities/Session';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';

export interface ListSessionsInput {
  tenantId: string;
}

export interface SessionWithAvatar {
  session: Session;
  /** Foto do número conectado; null quando a sessão está fora do ar ou sem foto. */
  avatarUrl: string | null;
}

export class ListSessionsUseCase {
  constructor(
    private readonly sessionRepo: ISessionRepository,
    private readonly engine?: IMessagingEngine,
  ) {}

  async execute(input: ListSessionsInput): Promise<SessionWithAvatar[]> {
    const sessions = await this.sessionRepo.findAllByTenant(input.tenantId);

    return Promise.all(
      sessions.map(async (session) => {
        // Só faz sentido pedir a foto de sessão conectada: sem socket a consulta falha.
        if (!this.engine || !session.phone || session.status !== 'CONNECTED') {
          return { session, avatarUrl: null };
        }
        try {
          const avatarUrl = await this.engine.fetchProfilePicture(session.id, session.phone, false);
          return { session, avatarUrl };
        } catch {
          return { session, avatarUrl: null };
        }
      }),
    );
  }
}
