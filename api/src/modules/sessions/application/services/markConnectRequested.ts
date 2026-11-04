import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';

/**
 * Ponto único de LEASE-07: registra que o usuário pediu a sessão ligada
 * (`connectRequestedAt = COALESCE(atual, now())`). Chamar depois da validação
 * e antes de falar com a engine, para a adoção (E4) achar a sessão mesmo se
 * o processo cair no meio da conexão.
 */
export function markConnectRequested(
  sessionRepo: ISessionRepository,
  sessionId: string,
  tenantId: string,
): Promise<void> {
  return sessionRepo.markConnectRequested(sessionId, tenantId);
}
