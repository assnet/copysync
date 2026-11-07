import type { IExtensionInstallationRepository } from '../../domain/contracts/IExtensionInstallationRepository';
import type { IExtensionLifecycleRepository } from '../../domain/contracts/IExtensionLifecycleRepository';
import {
  EXTENSION_ID_PATTERN,
  HUB_FORWARDED_EVENTS,
  HUB_LIFECYCLE_ENVELOPE_TYPE,
  PUBLIC_SIGNAL_TYPES,
  UUID_PATTERN,
  VERSION_PATTERN,
  type PublicSignalType,
} from '../../domain/lifecycleEvents';
import { buildLifecycleOutboxPayload } from '../../domain/services/lifecycleOutboxPayload';

export interface LifecycleSignalInput {
  installationId: string;
  type: string;
  version: string;
  channel: string;
  dedupeKey: string;
  extensionId?: string;
}

const CHANNEL_PATTERN = /^[a-z0-9-]{1,16}$/;

/**
 * Sinal público da extensão (INSTALL/UPDATE/STARTUP). INSTALL de instalação desconhecida cria a
 * linha sem dono (precisa de `extensionId` válido). Linha com dono: só status/lastSeenAt mudam aqui;
 * versão e canal são do heartbeat autenticado. Outbox só para instalação com dono e `clientKey`.
 */
export class RecordLifecycleSignalUseCase {
  constructor(
    private readonly installationRepo: IExtensionInstallationRepository,
    private readonly lifecycleRepo: IExtensionLifecycleRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: LifecycleSignalInput): Promise<{ created: boolean }> {
    const type = input.type.toUpperCase() as PublicSignalType;
    if (!PUBLIC_SIGNAL_TYPES.includes(type) || !UUID_PATTERN.test(input.installationId)) return { created: false };
    const version = VERSION_PATTERN.test(input.version) && input.version.length <= 32 ? input.version : 'unknown';
    const channel = CHANNEL_PATTERN.test(input.channel) ? input.channel : 'unknown';
    const dedupeKey = input.dedupeKey.slice(0, 64);
    const occurredAt = this.now();

    let row = await this.installationRepo.findById(input.installationId);
    if (!row && type === 'INSTALL' && input.extensionId && EXTENSION_ID_PATTERN.test(input.extensionId)) {
      await this.installationRepo.createUnowned({
        installationId: input.installationId, extensionId: input.extensionId, channel, version, installedAt: occurredAt,
      });
      row = await this.installationRepo.findById(input.installationId);
    }
    if (!row) return { created: false };

    const tenantId = row.userId ? await this.lifecycleRepo.findTenantForInstallation(row.installationId) : null;
    const clientKey = tenantId && HUB_FORWARDED_EVENTS.has(type)
      ? await this.lifecycleRepo.findClientKeyForTenant(tenantId)
      : null;

    const result = await this.lifecycleRepo.record({
      event: { installationId: row.installationId, type, version, channel, dedupeKey, occurredAt, userId: row.userId, tenantId },
      outbox: clientKey
        ? {
            type: HUB_LIFECYCLE_ENVELOPE_TYPE,
            payload: buildLifecycleOutboxPayload({
              event: type, occurredAt, installationId: row.installationId, clientKey, version, channel,
            }),
          }
        : null,
    });
    if (!result.created) return result;

    if (row.status !== 'ACTIVE') await this.installationRepo.updateStatus(row.installationId, 'ACTIVE');
    await this.installationRepo.updateLastSeen(row.installationId, {
      lastSeenAt: occurredAt,
      ...(!row.userId && version !== 'unknown' && { version }),
    });
    return result;
  }
}
