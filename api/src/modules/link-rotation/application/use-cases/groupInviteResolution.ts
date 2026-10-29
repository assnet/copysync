import { GroupInviteNotAllowedError } from '../../../../shared/errors/internal/GroupErrors';
import {
  EngineNotReadyError,
  EngineTemporarilyUnavailableError,
  RecoverableConnectionError,
} from '../../../../shared/errors/internal/MessagingErrors';
import { SessionNotConnectedError } from '../../../../shared/errors/internal/SessionErrors';
import { LinkRotationGroupStatus } from '../../domain/enums/LinkRotationEnums';
import type { LinkRotationGroupEngine } from './linkRotationUseCaseDeps';

/** Resultado da tentativa de obter o convite pela sessão. */
export type InviteAttempt =
  | { kind: 'ok'; inviteCode: string }
  /** A conta não pode ver o convite (em geral, não é admin): pede link manual. */
  | { kind: 'not_allowed' }
  /** Sessão desconectada/engine fora: não dá para saber agora. */
  | { kind: 'unavailable' };

/** Sessão/engine indisponível: não derruba o salvamento (grupo fica com o que já tinha ou NEEDS_LINK). */
export function isEngineUnavailable(err: unknown): boolean {
  return (
    err instanceof SessionNotConnectedError ||
    err instanceof EngineNotReadyError ||
    err instanceof EngineTemporarilyUnavailableError ||
    err instanceof RecoverableConnectionError
  );
}

/** Outros erros do engine sobem (erro inesperado não vira NEEDS_LINK silencioso). */
export async function tryGroupInvite(
  engine: LinkRotationGroupEngine,
  sessionId: string,
  groupJid: string,
): Promise<InviteAttempt> {
  try {
    const { inviteCode } = await engine.getGroupInviteLink(sessionId, groupJid);
    return inviteCode ? { kind: 'ok', inviteCode } : { kind: 'not_allowed' };
  } catch (err) {
    if (err instanceof GroupInviteNotAllowedError) return { kind: 'not_allowed' };
    if (isEngineUnavailable(err)) return { kind: 'unavailable' };
    throw err;
  }
}

/** Status a partir do link e da última contagem: sem link → NEEDS_LINK; lotado → FULL; senão ACTIVE. */
export function groupStatusFor(
  hasLink: boolean,
  memberCount: number | null,
  capacity: number,
): LinkRotationGroupStatus {
  if (!hasLink) return LinkRotationGroupStatus.NEEDS_LINK;
  if (memberCount !== null && memberCount >= capacity) return LinkRotationGroupStatus.FULL;
  return LinkRotationGroupStatus.ACTIVE;
}
