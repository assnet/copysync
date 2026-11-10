import { prisma } from '../../../shared/database/prisma.client';
import type { IEntitlementReader } from '../../tenants/domain/contracts/IEntitlementReader';
import { PrismaEntitlementReader } from '../../tenants/infrastructure/repositories/PrismaEntitlementReader';

/** Leitor de entitlements do tenant para a listagem de credenciais. Rotas não importam `prisma`. */
export const createAffiliateEntitlementReader = (): IEntitlementReader => new PrismaEntitlementReader(prisma);
