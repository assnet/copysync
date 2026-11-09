import type { IIncomingMediaPolicy, IncomingMediaContext } from '../../domain/contracts/IIncomingMediaPolicy';
import type { IChatEntitlementGate } from '../../../chat/domain/contracts/IChatEntitlementGate';
import type { IGroupMonitorRepository } from '../../../automation/domain/contracts/IGroupMonitorRepository';
import { TtlCache } from '../../../chat/infrastructure/entitlement/ttlCache';
import { logger } from '../../../../shared/logger/logger';

const MONITORED_TTL_MS = 60_000;

/**
 * Download de mídia recebida por entitlement. Chat ligado: regra atual da engine. Chat desligado:
 * só `IMAGE` de grupo monitorado — a captura usa o `mediaUrl` baixado como foto da oferta
 * (`RegisterCapturedMessageUseCase`, que ignora `fromMe`). Contato, vídeo, áudio, documento,
 * prévia e mensagem nossa não baixam.
 */
export class EntitlementIncomingMediaPolicy implements IIncomingMediaPolicy {
  private readonly monitored: TtlCache<boolean>;

  constructor(
    private readonly gate: IChatEntitlementGate,
    private readonly monitors: Pick<IGroupMonitorRepository, 'findActiveMonitoredGroup'>,
    opts: { ttlMs?: number; now?: () => number } = {},
  ) {
    this.monitored = new TtlCache<boolean>(opts.ttlMs ?? MONITORED_TTL_MS, 20_000, opts.now);
  }

  async shouldDownload(ctx: IncomingMediaContext, currentRule: () => Promise<boolean>): Promise<boolean> {
    if (await this.gate.isChatEnabled(ctx.tenantId)) return currentRule();
    if (ctx.fromMe || ctx.msgType !== 'IMAGE' || !ctx.isGroup || !ctx.groupJid) return false;
    return this.isMonitored(ctx.tenantId, ctx.sessionId, ctx.groupJid);
  }

  private async isMonitored(tenantId: string, sessionId: string, groupJid: string): Promise<boolean> {
    try {
      return await this.monitored.get(`${tenantId}:${sessionId}:${groupJid}`, async () =>
        (await this.monitors.findActiveMonitoredGroup(tenantId, sessionId, groupJid)) !== null);
    } catch (err) {
      logger.warn({ err, tenantId, sessionId }, 'Failed to read monitored group; skipping media download');
      return false;
    }
  }
}
