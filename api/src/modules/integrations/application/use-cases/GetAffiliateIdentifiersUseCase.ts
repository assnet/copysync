import type { IAffiliateCredentialRepository } from '../../domain/contracts/IAffiliateCredentialRepository';
import type { AffiliateProvider } from '../../domain/enums/AffiliateProvider';
import { affiliateIdentifierLimitKey } from '../../domain/services/affiliateIdentifierEntitlement';
import { effectiveLinkedIdentifiers } from '../../domain/services/effectiveLinkedIdentifiers';
import type { IEntitlementReader } from '../../../tenants/domain/contracts/IEntitlementReader';
import { identifierLimitOf } from '../../../tenants/domain/services/affiliateIdentifierLimit';
import { AffiliateCredentialInvalidError } from '../../../../shared/errors/internal/AffiliateCredentialErrors';

export interface AffiliateIdentifiersInput {
  tenantId: string;
  provider: AffiliateProvider;
}

/** Etiquetas da conta e vinculação sob o limite do plano. Nunca vai para log nem auditoria. */
export interface AffiliateIdentifiersResult {
  /** Etiquetas vistas na última sincronização da sessão. */
  account: string[];
  primary: string | null;
  /** Vinculadas gravadas (além da principal), em ordem — inclusive as que o limite atual corta. */
  linked: string[];
  /** Limite efetivo do plano (principal incluída). */
  limit: number;
  /** Tamanho do conjunto efetivo (principal + vinculadas dentro do limite). */
  used: number;
}

/** Provider sem lista da conta (só o ML tem) → 422 no campo `provider`. */
export function requireIdentifierLimitKey(provider: AffiliateProvider): string {
  const key = affiliateIdentifierLimitKey(provider);
  if (!key) throw new AffiliateCredentialInvalidError('Provider has no account identifiers', 'provider');
  return key;
}

export function identifiersResult(
  c: { accountIdentifiers?: string[]; publicIdentifier: string | null; linkedIdentifiers?: string[] } | null,
  limit: number,
): AffiliateIdentifiersResult {
  const primary = c?.publicIdentifier ?? null;
  const linked = c?.linkedIdentifiers ?? [];
  return {
    account: c?.accountIdentifiers ?? [],
    primary,
    linked,
    limit,
    used: effectiveLinkedIdentifiers(primary, linked, limit).length,
  };
}

/** Sem credencial: estado vazio (a tela mostra "conecte a conta"), não 404. */
export class GetAffiliateIdentifiersUseCase {
  constructor(
    private readonly repo: IAffiliateCredentialRepository,
    private readonly entitlements: IEntitlementReader,
  ) {}

  async execute(input: AffiliateIdentifiersInput): Promise<AffiliateIdentifiersResult> {
    const key = requireIdentifierLimitKey(input.provider);
    const [credential, value] = await Promise.all([
      this.repo.findByTenantAndProvider(input.tenantId, input.provider),
      this.entitlements.getNumber(input.tenantId, key),
    ]);
    return identifiersResult(credential, identifierLimitOf(value));
  }
}
