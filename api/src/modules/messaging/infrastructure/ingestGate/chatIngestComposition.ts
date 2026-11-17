import { prisma } from '../../../../shared/database/prisma.client';
import { env } from '../../../../shared/config/env';
import type { IChatEntitlementGate } from '../../../chat/domain/contracts/IChatEntitlementGate';
import type { IIncomingMediaPolicy } from '../../domain/contracts/IIncomingMediaPolicy';
import { CachedChatEntitlementGate } from '../../../chat/infrastructure/entitlement/CachedChatEntitlementGate';
import { PrismaEntitlementReader } from '../../../tenants/infrastructure/repositories/PrismaEntitlementReader';
import { PrismaGroupMonitorRepository } from '../../../automation/infrastructure/repositories/PrismaGroupMonitorRepository';
import { ProductAwareChatEntitlementGate } from '../../../chat/infrastructure/entitlement/ProductAwareChatEntitlementGate';
import { backgroundProductAccessEnforced, backgroundProductAccessReader } from '../../../tenants/infrastructure/productAccessContainer';
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
 * `CHAT_INGEST_ENTITLEMENT_GATE_ENABLED=false` fora de `enforce` devolve vazio: nada muda nem é consultado.
 */
export function chatIngestComposition(): ChatIngestComposition {
  if (instance) return instance;
  // Acesso por produto em `enforce` (design product-access §3.5): `CHAT` inativo = chat desligado, com ou sem a flag.
  const products = backgroundProductAccessEnforced() ? backgroundProductAccessReader() : null;
  if (!env.CHAT_INGEST_ENTITLEMENT_GATE_ENABLED) {
    instance = products ? { gate: new ProductAwareChatEntitlementGate(products) } : {};
    return instance;
  }
  const entitlementGate = new CachedChatEntitlementGate(new PrismaEntitlementReader(prisma));
  const gate = products ? new ProductAwareChatEntitlementGate(products, entitlementGate) : entitlementGate;
  instance = { gate, mediaPolicy: new EntitlementIncomingMediaPolicy(gate, new PrismaGroupMonitorRepository(prisma)) };
  return instance;
}
