import { prisma } from '../../../shared/database/prisma.client';
import { setActiveEngine } from '../../../shared/engine/activeEngine';
import { PrismaSessionRepository } from '../../sessions/infrastructure/repositories/PrismaSessionRepository';
import { PrismaSessionAuthStateRepository } from '../../sessions/infrastructure/repositories/PrismaSessionAuthStateRepository';
import { sessionLeaseContainer } from '../../sessions/infrastructure/lease/sessionLeaseContainer';
import { PrismaChatContactRepository } from '../../chat/infrastructure/repositories/PrismaChatContactRepository';
import { PrismaChatConversationRepository } from '../../chat/infrastructure/repositories/PrismaChatConversationRepository';
import { PrismaChatMessageRepository } from '../../chat/infrastructure/repositories/PrismaChatMessageRepository';
import { IngestHistorySyncUseCase } from '../../chat/application/use-cases/IngestHistorySyncUseCase';
import { MessagingEngineFactory } from './MessagingEngineFactory';
import { PrismaWatchedChannelSource } from './PrismaWatchedChannelSource';
import { chatIngestComposition } from './ingestGate/chatIngestComposition';
import type { MessagingEngineRouter } from './MessagingEngineRouter';

let instance: MessagingEngineRouter | undefined;

/**
 * Engine local do processo (WROLE-02): roteador por engine da sessão, montado na 1ª chamada.
 * Único `createRouter` do processo, sempre com o `leaseGate` do lease; a renovação do lease
 * derruba sockets por ele (`bindSocketControl`) e outros módulos o leem via `getActiveEngine()`.
 * Importar este módulo não instancia engine; quem não chama (papel `http`) não sobe socket.
 */
export function localEngine(): MessagingEngineRouter {
  if (instance) return instance;

  const chatContactRepo = new PrismaChatContactRepository(prisma);
  const chatConversationRepo = new PrismaChatConversationRepository(prisma);
  const chatMessageRepo = new PrismaChatMessageRepository(prisma);
  const lease = sessionLeaseContainer();
  // Mesma composição do server.ts: sem ela o `append`/histórico do worker ficaria sem gate.
  const ingestGate = chatIngestComposition();

  const engine = MessagingEngineFactory.createRouter({
    sessionRepo: new PrismaSessionRepository(),
    authStateRepo: new PrismaSessionAuthStateRepository(),
    chatContactRepo,
    chatConversationRepo,
    historySyncUseCase: new IngestHistorySyncUseCase(chatContactRepo, chatConversationRepo, chatMessageRepo, ingestGate.gate),
    leaseGate: lease.gate,
    watchedChannels: new PrismaWatchedChannelSource(prisma),
    mediaPolicy: ingestGate.mediaPolicy,
  });
  lease.bindSocketControl(engine);
  setActiveEngine(engine);
  instance = engine;
  return engine;
}
