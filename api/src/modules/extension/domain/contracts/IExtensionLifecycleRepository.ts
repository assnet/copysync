import type { LifecycleEventType } from '../lifecycleEvents';
import type { LifecycleOutboxPayload } from '../services/lifecycleOutboxPayload';

export interface LifecycleEventRecord {
  installationId: string | null;
  type: LifecycleEventType;
  version: string;
  channel: string;
  dedupeKey: string;
  occurredAt: Date;
  userId?: string | null;
  tenantId?: string | null;
  source?: string | null;
}

/** Evento + linha do outbox gravados na mesma transação (o outbox só entra com `clientKey`). */
export interface LifecycleWrite {
  event: LifecycleEventRecord;
  outbox?: { type: string; payload: LifecycleOutboxPayload } | null;
}

export interface AttributedStoreClick {
  id: string;
  occurredAt: Date;
}

export interface IExtensionLifecycleRepository {
  /** false = evento repetido (unique installationId+dedupeKey) ou instalação desconhecida. */
  record(write: LifecycleWrite): Promise<{ created: boolean }>;
  /**
   * STORE_CLICK com dedupe por usuário: se já houver clique do usuário desde `dedupeSince`, não grava.
   * Serializado por usuário (advisory lock) para cliques simultâneos não duplicarem.
   */
  recordStoreClick(write: LifecycleWrite & { dedupeSince: Date }): Promise<{ recorded: boolean; id: string | null }>;
  /** Liga o clique mais recente do usuário, ainda sem instalação e desde `since`, a esta instalação. */
  attributeStoreClick(userId: string, installationId: string, since: Date): Promise<AttributedStoreClick | null>;
  /** `Tenant.billingCustomerId` (id do cliente na central) ou null. */
  findClientKeyForTenant(tenantId: string): Promise<string | null>;
  /** Tenant da sessão de extensão mais recente desta instalação. */
  findTenantForInstallation(installationId: string): Promise<string | null>;
  upsertUninstallFeedback(input: { installationId: string; reasons: string[]; comment: string | null; version: string | null }): Promise<boolean>;
}
