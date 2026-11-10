import type { AffiliateProvider } from '../../domain/enums/AffiliateProvider';
import type { AffiliateCredentialStatus } from '../../domain/enums/AffiliateCredentialStatus';

export interface UpsertAffiliateCredentialInput {
  tenantId: string;
  userId: string;
  provider: AffiliateProvider;
  publicIdentifier: string;
  /** Ausente ou vazio em registro existente = mantém o atual. */
  secret?: string;
}

export interface AffiliateCredentialKeyInput {
  tenantId: string;
  userId: string;
  provider: AffiliateProvider;
}

export interface SetAffiliateCredentialStatusInput extends AffiliateCredentialKeyInput {
  status: AffiliateCredentialStatus;
}

export interface UpsertAffiliateSessionInput {
  tenantId: string;
  userId: string;
  provider: AffiliateProvider;
  cookies: Record<string, string>;
  csrf?: string;
  affiliateTag?: string;
  /**
   * ID da conta da sessão, para provider em que o ID segue a sessão (`providerIdentifierFollowsSession`,
   * só SHEIN): substitui o `publicIdentifier` no create e no update. Quem chama já validou contra o token.
   */
  sessionIdentifier?: string;
  /** Relógio do navegador: só vai para a auditoria; `sessionSyncedAt` usa o do servidor. */
  capturedAt: string;
  /**
   * Resultado da checagem da sessão na loja feita no sync. VALID libera a loja mesmo com o
   * mesmo token; REJECTED grava a rejeição; ausente (loja fora do ar) = só token novo libera.
   */
  sessionCheck?: 'VALID' | 'REJECTED';
}

/** Sessão do marketplace decifrada — nunca sai por HTTP. */
export interface AffiliateSessionSecret {
  cookies: Record<string, string>;
  csrf?: string;
}

/** Formato legado — aceito na leitura, nunca gravado. */
export interface LegacyAffiliateSessionSecret {
  sessionToken: string;
  csrfToken: string;
}

/** Credencial pronta para gerar link. Só o Gerador de ofertas consome; não há rota. */
export interface ResolvedAffiliateCredential {
  provider: AffiliateProvider;
  publicIdentifier: string;
  secret: string | null;
  session: AffiliateSessionSecret | null;
}
