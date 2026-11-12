import type { IMarketplaceRiskAcceptanceRepository } from '../../domain/contracts/IMarketplaceRiskAcceptanceRepository';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type { AffiliateProvider } from '../../domain/enums/AffiliateProvider';
import type { MarketplaceRiskScope } from '../../domain/enums/MarketplaceRiskScope';
import { DEFAULT_MARKETPLACE_RISK_SCOPE } from '../../domain/enums/MarketplaceRiskScope';
import { currentRiskNoticeVersion } from '../../domain/services/marketplaceRiskNotice';
import { ForbiddenError } from '../../../../shared/errors/internal/AuthErrors';
import { AffiliateCredentialInvalidError } from '../../../../shared/errors/internal/AffiliateCredentialErrors';
import { MarketplaceRiskNoticeOutdatedError } from '../../../../shared/errors/internal/MarketplaceRiskErrors';

/** `pt-BR`, `en`, `es-ES`… só para registro: o idioma em que o aviso foi lido. */
const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;

export interface AcceptMarketplaceRiskInput {
  tenantId: string;
  userId: string;
  role: string;
  isSuperAdmin: boolean;
  provider: AffiliateProvider;
  /** Padrão `AFFILIATE_LINK`. `OFFER_HUNTER` só existe para SHEIN. */
  scope?: MarketplaceRiskScope;
  noticeVersion: string;
  locale: string;
}

/** Repositórios presos à mesma transação: aceite + auditoria num só commit. */
export type MarketplaceRiskAcceptTransaction = <T>(
  fn: (r: { acceptances: IMarketplaceRiskAcceptanceRepository; audit: IAuditLogRepository }) => Promise<T>,
) => Promise<T>;

export interface AcceptMarketplaceRiskOutput {
  acceptedAt: Date;
  noticeVersion: string;
  scope: MarketplaceRiskScope;
}

/**
 * Admin do tenant aceita o aviso de risco vigente do marketplace. Super admin nunca aceita por
 * um tenant (recebe `tenantContext` de qualquer um). Repetir a mesma versão devolve o aceite original.
 */
export class AcceptMarketplaceRiskUseCase {
  constructor(private readonly transaction: MarketplaceRiskAcceptTransaction) {}

  async execute(input: AcceptMarketplaceRiskInput): Promise<AcceptMarketplaceRiskOutput> {
    if (input.isSuperAdmin || input.role !== 'ADMIN') {
      throw new ForbiddenError('Only a tenant admin can accept the marketplace risk notice');
    }
    const scope = input.scope ?? DEFAULT_MARKETPLACE_RISK_SCOPE;
    const current = currentRiskNoticeVersion(input.provider, scope);
    if (current === null) {
      throw scope === DEFAULT_MARKETPLACE_RISK_SCOPE
        ? new AffiliateCredentialInvalidError('Provider has no risk notice', 'provider')
        : new AffiliateCredentialInvalidError('Provider has no risk notice for this scope', 'scope');
    }
    if (input.noticeVersion !== current) {
      throw new MarketplaceRiskNoticeOutdatedError(input.provider, current, scope);
    }
    if (!LOCALE_PATTERN.test(input.locale)) {
      throw new AffiliateCredentialInvalidError('Invalid locale', 'locale');
    }

    return this.transaction(async ({ acceptances, audit }) => {
      const { acceptance, created } = await acceptances.create({
        tenantId: input.tenantId,
        provider: input.provider,
        scope,
        noticeVersion: current,
        acceptedByUserId: input.userId,
        locale: input.locale,
      });
      if (created) {
        await audit.create({
          tenantId: input.tenantId,
          userId: input.userId,
          action: 'MARKETPLACE_RISK_ACCEPTED',
          meta: { provider: input.provider, scope, noticeVersion: current, locale: input.locale },
        });
      }
      return { acceptedAt: acceptance.acceptedAt, noticeVersion: acceptance.noticeVersion, scope: acceptance.scope };
    });
  }
}
