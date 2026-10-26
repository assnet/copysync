import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';

/** Credencial decifrada, só em memória. Nunca vai para DTO, log ou meta. */
export interface OfferAffiliateCredential {
  provider: AffiliateProvider;
  publicIdentifier: string;
  secret: string | null;
}

/** Mesmo formato de `ResolveAffiliateCredentialUseCase.execute`; null = sem credencial ativa. */
export interface IAffiliateCredentialResolver {
  execute(tenantId: string, provider: AffiliateProvider): Promise<OfferAffiliateCredential | null>;
}
