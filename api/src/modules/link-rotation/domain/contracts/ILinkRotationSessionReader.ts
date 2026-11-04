import type { LinkRotationChannel } from '../services/inviteUrl';

/** Sessão vista pelo rodízio: só o que o painel e as regras precisam. */
export interface LinkRotationSessionRef {
  id: string;
  name: string;
  /** Status de conexão (mesmos valores de `SessionStatus`). */
  status: string;
  /** Canal da sessão (`Session.engine`). */
  channel: LinkRotationChannel;
  /** Número/conta conectada (foto da sessão); null antes de parear. */
  phone: string | null;
}

/**
 * Leitura das sessões do tenant para o rodízio (contrato próprio, sem acoplar ao módulo
 * `sessions`). Sessão com `deletedAt` não aparece. Tudo filtrado por `tenantId`.
 */
export interface ILinkRotationSessionReader {
  listByTenant(tenantId: string): Promise<LinkRotationSessionRef[]>;
  findById(tenantId: string, sessionId: string): Promise<LinkRotationSessionRef | null>;
}
