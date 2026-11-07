import type { IExtensionInstallationRepository } from '../../domain/contracts/IExtensionInstallationRepository';
import type { IExtensionLifecycleRepository } from '../../domain/contracts/IExtensionLifecycleRepository';
import {
  HUB_LIFECYCLE_ENVELOPE_TYPE,
  LIFECYCLE_EVENT,
  UNINSTALL_COMMENT_MAX,
  UNINSTALL_REASONS,
  UUID_PATTERN,
  VERSION_PATTERN,
  type UninstallReason,
} from '../../domain/lifecycleEvents';
import { buildLifecycleOutboxPayload } from '../../domain/services/lifecycleOutboxPayload';

export interface RecordUninstallInput {
  installationId: string;
  version?: string;
  feedback?: { reasons: string[]; comment?: string | null };
}

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;

/** Comentário sem e-mail/telefone, aparado e no teto. Função pura exportada para teste. */
export function sanitizeFeedbackComment(comment: string | null | undefined): string | null {
  if (!comment) return null;
  const clean = comment.replace(EMAIL, '[removido]').replace(PHONE, '[removido]').trim().slice(0, UNINSTALL_COMMENT_MAX);
  return clean || null;
}

export function normalizeReasons(reasons: readonly string[]): UninstallReason[] {
  const allowed = new Set<string>(UNINSTALL_REASONS);
  return [...new Set(reasons)].filter((r): r is UninstallReason => allowed.has(r));
}

/**
 * Página pública de desinstalação (setUninstallURL da extensão). Mesma resposta para instalação
 * conhecida ou não. UNINSTALL e UNINSTALL_FEEDBACK gravam uma vez por instalação; reenvio da
 * pesquisa substitui motivos/comentário. O comentário fica só no banco local (nunca no outbox).
 */
export class RecordUninstallUseCase {
  constructor(
    private readonly installationRepo: IExtensionInstallationRepository,
    private readonly lifecycleRepo: IExtensionLifecycleRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: RecordUninstallInput): Promise<{ accepted: boolean }> {
    if (!UUID_PATTERN.test(input.installationId)) return { accepted: false };
    const reasons = input.feedback ? normalizeReasons(input.feedback.reasons) : [];
    if (input.feedback && reasons.length === 0) return { accepted: false };

    const row = await this.installationRepo.findById(input.installationId);
    if (!row) return { accepted: true };

    const version = input.version && VERSION_PATTERN.test(input.version) ? input.version : row.version;
    const occurredAt = this.now();
    const tenantId = row.userId ? await this.lifecycleRepo.findTenantForInstallation(row.installationId) : null;
    const clientKey = tenantId ? await this.lifecycleRepo.findClientKeyForTenant(tenantId) : null;

    const write = async (event: typeof LIFECYCLE_EVENT.UNINSTALL | typeof LIFECYCLE_EVENT.UNINSTALL_FEEDBACK) =>
      this.lifecycleRepo.record({
        event: {
          installationId: row.installationId, type: event, version, channel: row.channel,
          dedupeKey: event, occurredAt, userId: row.userId, tenantId,
        },
        outbox: clientKey
          ? {
              type: HUB_LIFECYCLE_ENVELOPE_TYPE,
              payload: buildLifecycleOutboxPayload({
                event, occurredAt, installationId: row.installationId, clientKey, version, channel: row.channel,
                reasons: event === LIFECYCLE_EVENT.UNINSTALL_FEEDBACK ? reasons : undefined,
              }),
            }
          : null,
      });

    await write(LIFECYCLE_EVENT.UNINSTALL);
    if (row.status !== 'UNINSTALLED') await this.installationRepo.updateStatus(row.installationId, 'UNINSTALLED');

    if (input.feedback) {
      await this.lifecycleRepo.upsertUninstallFeedback({
        installationId: row.installationId, reasons, comment: sanitizeFeedbackComment(input.feedback.comment), version,
      });
      await write(LIFECYCLE_EVENT.UNINSTALL_FEEDBACK);
    }
    return { accepted: true };
  }
}
