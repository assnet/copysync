import { prisma } from '../../../shared/database/prisma.client';
import { PrismaLinkDomainRepository } from './repositories/PrismaLinkDomainRepository';
import { PrismaLinkRotationRepository } from './repositories/PrismaLinkRotationRepository';
import { PrismaLinkClickRepository } from './repositories/PrismaLinkClickRepository';

/*
 * Composição do rodízio de links (design.md §4.5). Tudo lazy: importar não toca banco.
 * Use cases (T7/T8/T9) entram abaixo, recebendo os repositórios daqui; entitlements via
 * `offersContainer` e engine via factory, também resolvidos no uso.
 */
function lazy<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

const domains   = lazy(() => new PrismaLinkDomainRepository(prisma));
const rotations = lazy(() => new PrismaLinkRotationRepository(prisma));
const clicks    = lazy(() => new PrismaLinkClickRepository(prisma));

export const linkRotationContainer = {
  get domainRepository(): PrismaLinkDomainRepository { return domains(); },
  get rotationRepository(): PrismaLinkRotationRepository { return rotations(); },
  get clickRepository(): PrismaLinkClickRepository { return clicks(); },
  // ── use cases (T7+) ──
};
