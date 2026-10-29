/** Espelho do enum Prisma `PremiumSlugGrantSource`. */
export type PremiumSlugGrantSource = 'MANUAL' | 'BILLING';

/** Nome premium de um domínio liberado para um tenant. `expiresAt` null = sem validade. */
export interface PremiumSlugGrant {
  id: string;
  domainId: string;
  slug: string;
  tenantId: string;
  source: PremiumSlugGrantSource;
  expiresAt: Date | null;
  createdAt: Date;
}
