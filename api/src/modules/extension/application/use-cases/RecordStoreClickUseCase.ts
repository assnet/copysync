import type { IExtensionLifecycleRepository } from '../../domain/contracts/IExtensionLifecycleRepository';
import {
  HUB_LIFECYCLE_ENVELOPE_TYPE,
  LIFECYCLE_EVENT,
  STORE_CLICK_DEDUPE_WINDOW_MS,
  type StoreClickSource,
} from '../../domain/lifecycleEvents';
import { buildLifecycleOutboxPayload } from '../../domain/services/lifecycleOutboxPayload';

export interface RecordStoreClickInput {
  userId: string;
  tenantId: string;
  source: StoreClickSource;
}

/**
 * Clique em "Instalar da Chrome Web Store" no painel. Vira STORE_CLICK sem instalação; o vínculo
 * da primeira extensão do mesmo usuário (até 7 dias) atribui o clique (IssueExtensionSessionUseCase).
 */
export class RecordStoreClickUseCase {
  constructor(
    private readonly lifecycleRepo: IExtensionLifecycleRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: RecordStoreClickInput): Promise<{ recorded: boolean }> {
    const occurredAt = this.now();
    const clientKey = await this.lifecycleRepo.findClientKeyForTenant(input.tenantId);
    const { recorded } = await this.lifecycleRepo.recordStoreClick({
      dedupeSince: new Date(occurredAt.getTime() - STORE_CLICK_DEDUPE_WINDOW_MS),
      event: {
        installationId: null,
        type: LIFECYCLE_EVENT.STORE_CLICK,
        version: 'unknown',
        channel: 'cs-ext',
        dedupeKey: `STORE_CLICK:${input.userId}:${occurredAt.getTime()}`,
        occurredAt,
        userId: input.userId,
        tenantId: input.tenantId,
        source: input.source,
      },
      outbox: clientKey
        ? {
            type: HUB_LIFECYCLE_ENVELOPE_TYPE,
            payload: buildLifecycleOutboxPayload({
              event: LIFECYCLE_EVENT.STORE_CLICK, occurredAt, installationId: null, clientKey, source: input.source,
            }),
          }
        : null,
    });
    return { recorded };
  }
}
