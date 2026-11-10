import { PrismaAuditLogRepository } from '../../../shared/audit/PrismaAuditLogRepository';
import { UnitOfWork } from '../../../shared/database/UnitOfWork';
import type { IMarketplaceRiskAcceptanceRepository } from '../domain/contracts/IMarketplaceRiskAcceptanceRepository';
import type { MarketplaceRiskAcceptTransaction } from '../application/use-cases/AcceptMarketplaceRiskUseCase';
import { PrismaMarketplaceRiskAcceptanceRepository } from './repositories/PrismaMarketplaceRiskAcceptanceRepository';

/** Aceite e AuditLog no mesmo `tx`: falha na auditoria desfaz o aceite (o retry audita). */
export const prismaMarketplaceRiskAcceptTransaction: MarketplaceRiskAcceptTransaction = (fn) =>
  new UnitOfWork().runInTransaction((tx) =>
    fn({ acceptances: new PrismaMarketplaceRiskAcceptanceRepository(tx), audit: new PrismaAuditLogRepository(tx) }));

/** Repositório fora de transação (leituras, gate). Rotas não importam `prisma`. */
export const createMarketplaceRiskAcceptanceRepository = (): IMarketplaceRiskAcceptanceRepository =>
  new PrismaMarketplaceRiskAcceptanceRepository();
