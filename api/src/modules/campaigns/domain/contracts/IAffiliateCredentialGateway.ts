import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { IAffiliateCredentialResolver, OfferAffiliateCredential } from './IAffiliateCredentialResolver';

export type AffiliateCredentialState =
  | { state: 'ok'; cred: OfferAffiliateCredential }
  | { state: 'missing' }
  /** Loja recusou a credencial; o monitoramento não chama a loja até o usuário reconfigurar. */
  | { state: 'rejected'; since: Date; code: string | null };

/** Resolver + estado de rejeição, para quem usa a credencial sem o usuário na frente (monitoramento). */
export interface IAffiliateCredentialGateway extends IAffiliateCredentialResolver {
  resolveState(tenantId: string, provider: AffiliateProvider): Promise<AffiliateCredentialState>;
  markRejected(tenantId: string, provider: AffiliateProvider, code: string): Promise<void>;
}
