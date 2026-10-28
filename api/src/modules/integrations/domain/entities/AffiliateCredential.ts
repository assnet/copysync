import type { AffiliateProvider } from '../enums/AffiliateProvider';
import type { AffiliateCredentialStatus } from '../enums/AffiliateCredentialStatus';

/**
 * Credencial de afiliado de um tenant num marketplace — visão sem segredo.
 *
 * `publicIdentifier` null = linha criada pela extensão (sessão) antes de o operador informar o ID.
 * Segredo e sessão aparecem só como flags; o blob cifrado vive em `AffiliateCredentialRecord`.
 */
export interface AffiliateCredential {
  id: string;
  tenantId: string;
  provider: AffiliateProvider;
  publicIdentifier: string | null;
  hasSecret: boolean;
  hasSession: boolean;
  sessionSyncedAt: Date | null;
  sessionInvalidAt: Date | null;
  sessionAccountHash: string | null;
  sessionAccountKeyVersion: number | null;
  status: AffiliateCredentialStatus;
  lastValidatedAt: Date | null;
  /** Loja recusou a credencial no uso; o monitoramento pausa a loja. Zera ao salvar chave/sessão nova. */
  rejectedAt: Date | null;
  rejectedCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}
