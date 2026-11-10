import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/database/prisma.client';
import type { TransactionClient } from '../../../../shared/database/UnitOfWork';
import { InfrastructureError } from '../../../../shared/errors/InfrastructureError';
import { PrismaMarketplaceRiskAcceptanceMapper as Mapper } from '../mappers/PrismaMarketplaceRiskAcceptanceMapper';
import type {
  CreateMarketplaceRiskAcceptanceRecord,
  CreateMarketplaceRiskAcceptanceResult,
  IMarketplaceRiskAcceptanceRepository,
} from '../../domain/contracts/IMarketplaceRiskAcceptanceRepository';
import type { MarketplaceRiskAcceptance } from '../../domain/entities/MarketplaceRiskAcceptance';
import type { AffiliateProvider } from '../../domain/enums/AffiliateProvider';

function toInfrastructureError(err: unknown): Error {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return new InfrastructureError('MARKETPLACE_RISK_PERSISTENCE_FAILED', `Persistence failed (${err.code})`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Só leitura e inclusão: nenhuma linha é alterada nem apagada por aqui.
 * `db` = `prisma` ou `tx` de UnitOfWork (aceite + auditoria no mesmo commit).
 */
export class PrismaMarketplaceRiskAcceptanceRepository implements IMarketplaceRiskAcceptanceRepository {
  private readonly db: TransactionClient;
  constructor(db?: TransactionClient) { this.db = db ?? prisma; }

  async findCurrent(
    tenantId: string,
    provider: AffiliateProvider,
    noticeVersion: string,
  ): Promise<MarketplaceRiskAcceptance | null> {
    const raw = await this.db.marketplaceRiskAcceptance.findUnique({
      where: { tenantId_provider_noticeVersion: { tenantId, provider, noticeVersion } },
    });
    return raw ? Mapper.toDomain(raw) : null;
  }

  async create(input: CreateMarketplaceRiskAcceptanceRecord): Promise<CreateMarketplaceRiskAcceptanceResult> {
    // Leitura antes: aceite repetido não passa pelo P2002 (que o Prisma loga como erro).
    const found = await this.findCurrent(input.tenantId, input.provider, input.noticeVersion);
    if (found) return { acceptance: found, created: false };
    try {
      // ON CONFLICT DO NOTHING: dentro de transação um P2002 abortaria o tx e a releitura falharia.
      const { count } = await this.db.marketplaceRiskAcceptance.createMany({ data: [{ ...input }], skipDuplicates: true });
      const row = await this.findCurrent(input.tenantId, input.provider, input.noticeVersion);
      if (!row) throw new InfrastructureError('MARKETPLACE_RISK_PERSISTENCE_FAILED', 'Acceptance not found after insert');
      // count 0 = aceite simultâneo da mesma versão venceu: vale o primeiro.
      return { acceptance: row, created: count === 1 };
    } catch (err) {
      throw toInfrastructureError(err);
    }
  }

  async listByTenant(tenantId: string): Promise<MarketplaceRiskAcceptance[]> {
    const rows = await this.db.marketplaceRiskAcceptance.findMany({
      where: { tenantId },
      orderBy: [{ acceptedAt: 'desc' }, { id: 'asc' }],
    });
    return rows.map(Mapper.toDomain);
  }
}
