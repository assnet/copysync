import type { IAffiliateCredentialRepository } from '../../domain/contracts/IAffiliateCredentialRepository';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type { IEntitlementReader } from '../../../tenants/domain/contracts/IEntitlementReader';
import { identifierLimitOf } from '../../../tenants/domain/services/affiliateIdentifierLimit';
import {
  AffiliateCredentialInvalidError,
  AffiliateCredentialNotFoundError,
} from '../../../../shared/errors/internal/AffiliateCredentialErrors';
import { PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';
import {
  identifiersResult,
  requireIdentifierLimitKey,
  type AffiliateIdentifiersInput,
  type AffiliateIdentifiersResult,
} from './GetAffiliateIdentifiersUseCase';

export interface SetLinkedAffiliateIdentifiersInput extends AffiliateIdentifiersInput {
  userId: string;
  primary: string;
  linked: string[];
}

/**
 * Escolhe a principal e as vinculadas entre as etiquetas da conta. Ordem das checagens: provider,
 * credencial, pertence à conta (sem caixa; grava a grafia da conta), sem repetição, limite do plano.
 * Não mexe em sessão nem em recusa. Etiquetas nunca vão no erro, no log nem na auditoria.
 */
export class SetLinkedAffiliateIdentifiersUseCase {
  constructor(
    private readonly repo: IAffiliateCredentialRepository,
    private readonly entitlements: IEntitlementReader,
    private readonly auditRepo: IAuditLogRepository,
  ) {}

  async execute(input: SetLinkedAffiliateIdentifiersInput): Promise<AffiliateIdentifiersResult> {
    const key = requireIdentifierLimitKey(input.provider);
    const [credential, value] = await Promise.all([
      this.repo.findByTenantAndProvider(input.tenantId, input.provider),
      this.entitlements.getNumber(input.tenantId, key),
    ]);
    if (!credential) throw new AffiliateCredentialNotFoundError(input.provider);

    const account = new Map((credential.accountIdentifiers ?? []).map((a) => [a.toLowerCase(), a]));
    const canonical = (raw: string, field: 'primary' | 'linked'): string => {
      const found = account.get(raw.trim().toLowerCase());
      if (!found) throw new AffiliateCredentialInvalidError('Identifier is not in the account', field);
      return found;
    };
    const primary = canonical(input.primary, 'primary');
    const linked = input.linked.map((l) => canonical(l, 'linked'));

    const all = [primary, ...linked].map((v) => v.toLowerCase());
    if (new Set(all).size !== all.length) throw new AffiliateCredentialInvalidError('Duplicate identifier', 'linked');

    const limit = identifierLimitOf(value);
    if (all.length > limit) throw new PlanLimitReachedError(key, limit);

    const saved = await this.repo.setIdentifiers(input.tenantId, input.provider, primary, linked);
    if (!saved) throw new AffiliateCredentialNotFoundError(input.provider);
    // Sync trocou a lista entre a leitura e a escrita: mesmo erro de "fora da conta".
    if (saved === 'ACCOUNT_CHANGED') throw new AffiliateCredentialInvalidError('Identifier is not in the account', 'linked');

    await this.auditRepo.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: 'AFFILIATE_CREDENTIAL_UPSERTED',
      meta: { provider: input.provider, identifiersChanged: true },
    });
    return identifiersResult(saved, limit);
  }
}
