import type { IOfferRepository } from '../../domain/contracts/IOfferRepository';
import type { IEntitlementReader } from '../../domain/contracts/IEntitlementReader';
import { startOfDayInZone } from '../../domain/services/startOfDayInZone';
import { OFFER_GENERATIONS_PER_DAY } from './GenerateOfferUseCase';

export interface OfferUsage {
  used: number;
  /** null = ilimitado. */
  limit: number | null;
}

/** Uso do dia (fuso America/Sao_Paulo) frente ao limite do plano. */
export class GetOfferUsageUseCase {
  constructor(
    private readonly offers: IOfferRepository,
    private readonly entitlements: IEntitlementReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(tenantId: string): Promise<OfferUsage> {
    const [used, limit] = await Promise.all([
      this.offers.countCreatedSince(tenantId, startOfDayInZone(this.now())),
      this.entitlements.getNumber(tenantId, OFFER_GENERATIONS_PER_DAY),
    ]);
    return { used, limit };
  }
}
