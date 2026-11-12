import type { OfferHunt, OfferHuntDefinition, OfferHuntPauseReason } from '../../hunter/OfferHunt';

export interface CreateOfferHuntInput extends OfferHuntDefinition {
  tenantId: string;
  nextRunAt: Date | null;
}

export type OfferHuntPatch = Partial<OfferHuntDefinition> & { nextRunAt?: Date | null };

/** Caçada reivindicada pelo job: só quem tem o `claimToken` grava o resultado (`releaseClaim`). */
export interface OfferHuntClaim {
  hunt: OfferHunt;
  claimToken: string;
}

/** Caçadas salvas. Toda consulta filtra `tenantId` (exceto a varredura `claimDue`, que é do job). */
export interface IOfferHuntRepository {
  /** Cria sob o teto de caçadas do tenant (serializado por tenant); `null` = teto atingido. */
  createWithinLimit(input: CreateOfferHuntInput, max: number): Promise<OfferHunt | null>;
  findById(tenantId: string, id: string): Promise<OfferHunt | null>;
  /** Mais nova primeiro (no máx. `HUNTER_LIMITS.huntsPerTenantMax`). */
  listByTenant(tenantId: string): Promise<OfferHunt[]>;
  countByTenant(tenantId: string): Promise<number>;
  /** null = não existe no tenant. */
  update(tenantId: string, id: string, patch: OfferHuntPatch): Promise<OfferHunt | null>;
  /** Execuções e achados ficam (huntId vira null). */
  delete(tenantId: string, id: string): Promise<boolean>;
  pause(tenantId: string, id: string, reason: OfferHuntPauseReason): Promise<boolean>;
  /** PAUSED → ACTIVE, zera falhas e motivo. */
  resume(tenantId: string, id: string, nextRunAt: Date | null): Promise<boolean>;
  /** Execução que chegou à fonte sem erro: `lastRunAt` e zera `consecutiveFailures`. */
  recordSuccess(tenantId: string, id: string, at: Date): Promise<void>;
  /** Fonte indisponível: +1 atômico; com `>= pauseAfter` pausa `SOURCE_UNAVAILABLE`. Devolve o novo total. */
  recordSourceFailure(tenantId: string, id: string, at: Date, pauseAfter: number): Promise<{ consecutiveFailures: number; paused: boolean }>;
  /**
   * Job: caçadas ACTIVE com `nextRunAt <= now` e sem posse vigente, no máx. `limit`, **1 por tenant**
   * (tenant com outra caçada em posse vigente fica de fora). CAS em `claimToken`/`claimedUntil`.
   */
  claimDue(now: Date, limit: number, leaseMs: number): Promise<OfferHuntClaim[]>;
  /** Solta a posse e agenda a próxima; false = posse perdida (outro token) — nada gravado. */
  releaseClaim(tenantId: string, id: string, claimToken: string, nextRunAt: Date | null): Promise<boolean>;
}
