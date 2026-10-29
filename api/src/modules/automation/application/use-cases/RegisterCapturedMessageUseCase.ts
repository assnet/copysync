import type { ICapturedOfferRepository } from '../../domain/contracts/ICapturedOfferRepository';
import type { IGroupMonitorRepository } from '../../domain/contracts/IGroupMonitorRepository';
import { extractUrls, matchesKeywords } from '../../domain/services/offerMessageText';
import { isWithinWindow, minuteOfDayInZone } from '../../domain/services/operatingWindow';

/** Fotos que o envio aceita (`SendStoredMediaMessageUseCase`). `image/jpg` vira `image/jpeg`. */
const SENDABLE_IMAGE = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface IncomingGroupMessage {
  tenantId: string;
  sessionId: string;
  isGroup?: boolean;
  fromMe?: boolean;
  groupJid?: string;
  externalMessageId?: string;
  body: string | null;
  msgType?: string;
  mediaUrl?: string | null;
  mimeType?: string | null;
}

export type RegisterResult = 'ignored' | 'outside_window' | 'duplicate' | 'captured';

/**
 * Listener do MESSAGE_RECEIVED: grava a mensagem de grupo monitorado como captura PENDING.
 * Barato e sem rede: texto sem link sai antes de qualquer consulta; a decisão vem do banco
 * (nada em memória). Quem processa é o worker.
 */
export class RegisterCapturedMessageUseCase {
  constructor(private readonly deps: { monitors: IGroupMonitorRepository; captured: ICapturedOfferRepository; now?: () => Date }) {}

  async execute(m: IncomingGroupMessage): Promise<RegisterResult> {
    if (!m.isGroup || m.fromMe || !m.groupJid || !m.externalMessageId) return 'ignored';
    const text = m.body?.trim() ?? '';
    if (!text || extractUrls(text).length === 0) return 'ignored';

    const group = await this.deps.monitors.findActiveMonitoredGroup(m.tenantId, m.sessionId, m.groupJid);
    if (!group || !matchesKeywords(text, group.keywords)) return 'ignored';
    const capturedAt = (this.deps.now ?? (() => new Date()))();
    // Fora da janela com "capturar fora do horário" desligado: nem entra na fila
    if (!group.captureOutsideWindow
      && !isWithinWindow(minuteOfDayInZone(capturedAt), { startMinute: group.windowStartMinute, endMinute: group.windowEndMinute })) {
      return 'outside_window';
    }

    const isImage = m.msgType === 'IMAGE';
    const mime = m.mimeType === 'image/jpg' ? 'image/jpeg' : m.mimeType ?? '';
    const sourceMediaUrl = isImage && m.mediaUrl && SENDABLE_IMAGE.has(mime) ? m.mediaUrl : null;

    const created = await this.deps.captured.createPending({
      tenantId: group.tenantId,
      sessionId: m.sessionId,
      configId: group.configId,
      monitoredGroupId: group.id,
      sourceExternalMessageId: m.externalMessageId,
      sourceText: text,
      sourceMediaUrl,
      imageUnavailable: isImage && !sourceMediaUrl,
      capturedAt,
    });
    return created ? 'captured' : 'duplicate';
  }
}
