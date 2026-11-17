import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaJobLease } from '../../../../shared/infrastructure/jobs/PrismaJobLease';
import { getActiveEngine } from '../../../../shared/engine/activeEngine';
import { productAccessReader } from '../../../tenants/infrastructure/productAccessContainer';
import { PrismaEntitlementReader } from '../../../tenants/infrastructure/repositories/PrismaEntitlementReader';
import { ProcessNextSaverItemUseCase } from '../../application/use-cases/ProcessNextSaverItemUseCase';
import { CloseOrphanSaverExtractionsUseCase } from '../../application/use-cases/CloseOrphanSaverExtractionsUseCase';
import { saverContainer } from '../saverContainer';
import { SaverExtractionJob } from './SaverExtractionJob';

/**
 * Montagem de produção. Ligar só com a flag (server.ts). Engine resolvido a cada tick (ausente = pula).
 * Produto `SAVER` é novo: sem linha = inativo em qualquer modo do gate, por isso o leitor com cache e não
 * o de segundo plano (que libera tudo fora de `enforce`). Falha de leitura devolve o item sem decidir.
 */
export function createSaverExtractionJob(): SaverExtractionJob {
  const c = saverContainer;
  const products = productAccessReader();
  const entitlements = new PrismaEntitlementReader(prisma);
  return new SaverExtractionJob({
    sessions: c.sessionStates,
    step: () => {
      const engine = getActiveEngine();
      if (!engine) return null;
      return new ProcessNextSaverItemUseCase({
        queue: c.queue,
        sessionStates: c.sessionStates,
        groups: c.groups,
        memberships: c.memberships,
        platformContacts: c.platformContacts,
        engine: { getGroupMembers: (sessionId, groupJid) => engine.getGroupMembers(sessionId, groupJid) },
        products,
        entitlements,
        knownContacts: c.knownContacts,
      });
    },
    maintenance: new CloseOrphanSaverExtractionsUseCase({ queue: c.queue }),
    lease: new PrismaJobLease(prisma),
  });
}
