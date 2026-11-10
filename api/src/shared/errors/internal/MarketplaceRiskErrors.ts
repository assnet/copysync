import { AppError } from '../AppError';

// ── Aviso de risco do marketplace (docs: .specs/features/shein-affiliate) ─────

/** O tenant não aceitou a versão vigente do aviso de risco do marketplace. */
export class MarketplaceRiskNotAcceptedError extends AppError {
  constructor(provider: string, noticeVersion: string) {
    super('MARKETPLACE_RISK_NOT_ACCEPTED', `Marketplace risk notice not accepted: ${provider}`, 403, {
      provider,
      noticeVersion,
    });
  }
}

/** O aceite enviado é de uma versão do aviso que não é mais a vigente: o painel recarrega o texto. */
export class MarketplaceRiskNoticeOutdatedError extends AppError {
  constructor(provider: string, currentVersion: string) {
    super('MARKETPLACE_RISK_NOTICE_OUTDATED', `Marketplace risk notice is outdated: ${provider}`, 409, {
      provider,
      currentVersion,
    });
  }
}
