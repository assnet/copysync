import type { LifecycleEventType } from '../lifecycleEvents';

/** `payload` do envelope `extension.lifecycle` no outbox. Sem PII: só ids e versões. */
export interface LifecycleOutboxPayload {
  event: LifecycleEventType;
  occurredAt: string;
  installationId: string | null;
  clientKey: string;
  version: string | null;
  channel: string | null;
  source?: string;
  storeClickId?: string;
  storeClickAt?: string;
  reasons?: string[];
}

export interface LifecycleOutboxInput {
  event: LifecycleEventType;
  occurredAt: Date;
  installationId: string | null;
  clientKey: string;
  version?: string | null;
  channel?: string | null;
  source?: string | null;
  storeClick?: { id: string; occurredAt: Date } | null;
  reasons?: readonly string[];
}

/** Função pura: monta o payload; campos opcionais só aparecem quando existem. */
export function buildLifecycleOutboxPayload(input: LifecycleOutboxInput): LifecycleOutboxPayload {
  return {
    event: input.event,
    occurredAt: input.occurredAt.toISOString(),
    installationId: input.installationId,
    clientKey: input.clientKey,
    version: input.version && input.version !== 'unknown' ? input.version : null,
    channel: input.channel && input.channel !== 'unknown' ? input.channel : null,
    ...(input.source ? { source: input.source } : {}),
    ...(input.storeClick ? { storeClickId: input.storeClick.id, storeClickAt: input.storeClick.occurredAt.toISOString() } : {}),
    ...(input.reasons?.length ? { reasons: [...input.reasons] } : {}),
  };
}
