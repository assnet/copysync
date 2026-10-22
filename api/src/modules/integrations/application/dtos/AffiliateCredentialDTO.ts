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
  sessionToken: string;
  csrfToken: string;
  affiliateTag?: string;
  /** Relógio do navegador: só vai para a auditoria; `sessionSyncedAt` usa o do servidor. */
  capturedAt: string;
}

/** Sessão do marketplace decifrada — nunca sai por HTTP. */
export interface AffiliateSessionSecret {
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
