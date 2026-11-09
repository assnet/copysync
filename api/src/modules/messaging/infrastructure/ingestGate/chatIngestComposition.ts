import { prisma } from '../../../../shared/database/prisma.client';
import { env } from '../../../../shared/config/env';
import type { IChatEntitlementGate } from '../../../chat/domain/contracts/IChatEntitlementGate';
import type { IIncomingMediaPolicy } from '../../domain/contracts/IIncomingMediaPolicy';
import { CachedChatEntitlementGate } from '../../../chat/infrastructure/entitlement/CachedChatEntitlementGate';
import { PrismaEntitlementReader } from '../../../tenants/infrastructure/repositories/PrismaEntitlementReader';
import { PrismaGroupMonitorRepository } from '../../../automation/infrastructure/repositories/PrismaGroupMonitorRepository';
import { EntitlementIncomingMediaPolicy } from './EntitlementIncomingMediaPolicy';

export interface ChatIngestComposition {
  /** Ausente = flag desligada: ingestão de hoje para todos. */
  gate?: IChatEntitlementGate;
  /** Ausente = regra atual da engine. */
  mediaPolicy?: IIncomingMediaPolicy;
}

let instance: ChatIngestComposition | undefined;

/**
 * Composição única de gate + política de mídia (entrega D): `server.ts` (use cases e listeners do
 * chat) e `localEngineContainer` (adapters e `append`) usam a mesma instância e o mesmo cache.
 * `CHAT_INGEST_ENTITLEMENT_GATE_ENABLED=false` devolve vazio: nada muda nem é consultado.
 */
export function chatIngestComposition(): ChatIngestComposition {
  if (instance) return instance;
  if (!env.CHAT_INGEST_ENTITLEMENT_GATE_ENABLED) {
    instance = {};
    return instance;
  }
  const gate = new CachedChatEntitlementGate(new PrismaEntitlementReader(prisma));
  instance = { gate, mediaPolicy: new EntitlementIncomingMediaPolicy(gate, new PrismaGroupMonitorRepository(prisma)) };
  return instance;
}
