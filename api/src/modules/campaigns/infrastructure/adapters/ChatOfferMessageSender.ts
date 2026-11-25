import type {
  IOfferMessageSender,
  SendOfferMessageInput,
} from '../../domain/contracts/IOfferMessageSender';
import { SendMessageUseCase } from '../../../chat/application/use-cases/SendMessageUseCase';
import { chatMediaContainer } from '../../../chat/infrastructure/chatMediaContainer';
import { ChatMessageStatus } from '../../../chat/domain/enums/ChatMessageEnums';
import { getActiveEngine } from '../../../../shared/engine/activeEngine';
import { MessageSendFailedError } from '../../../../shared/errors/internal/MessagingErrors';
import { SessionNotConnectedError } from '../../../../shared/errors/internal/SessionErrors';
import { OfferDestinationUnavailableError } from '../../../../shared/errors/internal/OfferErrors';
import { offerImageMimeFromUrl } from './offerImageTypes';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import { logger } from '../../../../shared/logger/logger';
import { resolveConversationTarget } from '../../../chat/application/use-cases/resolveConversationTarget';
import { OFFER_TYPING_SECONDS_MAX } from '../../domain/offerTyping';
import type { ChatConversation } from '../../../chat/domain/entities/ChatConversation';
import type { IOfferPreviewImage } from '../../domain/contracts/IOfferPreviewImage';
import type { IMediaFileStore } from '../../../media/domain/contracts/IMediaFileStore';
import type { OutboundLinkPreview } from '../../../messaging/domain/contracts/IMessagingEngine';
import { pickPreviewUrl } from '../../domain/services/pickPreviewUrl';
import type { IFeatureUsageRecorder } from '../../../metrics/domain/contracts/IFeatureUsageRecorder';
import type { IOfferImageDecorator } from '../../domain/contracts/IOfferImageDecorator';
import { MediaNotFoundError } from '../../../../shared/errors/internal/MediaErrors';

const log = logger.child({ module: 'ChatOfferMessageSender' });

/**
 * Limite da legenda de foto no Telegram (`caption_length_limit_default`; Premium 4096, mas a conta
 * pode não ser). Comparado com `[...text].length` do texto cru, que é ≥ o visível (conservador).
 */
export const TELEGRAM_CAPTION_MAX = 1024;

/** O WhatsApp apaga o "digitando…" em ~10 s; reenviar antes disso mantém o indicador. */
export const PRESENCE_REFRESH_MS = 8_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Dependências da prévia de link. Ausentes: LINK_PREVIEW sai como texto puro / sem miniatura no chat. */
export interface ChatOfferMessageSenderDeps {
  previewImage?: () => IOfferPreviewImage;
  files?: () => IMediaFileStore;
  /** Mesmo contador do painel; o envio sai como `AUTOMATION` e por isso não soma em `chat_send`. */
  usage?: () => IFeatureUsageRecorder;
  /** Marca d'água do tenant: decide o ramo do Telegram e decora a mídia. Ausente = sem marca. */
  decorator?: () => IOfferImageDecorator;
}

/**
 * Envia a oferta pelo chat. Com foto em MEDIA: mídia armazenada (PENDING + fila, como o painel).
 * Sem foto ou em LINK_PREVIEW: o mesmo `SendMessageUseCase` da rota do painel (com `linkPreview`
 * quando há link, título e imagem; senão texto puro). Use cases montados por envio
 * para pegar a engine ativa na hora; repositórios e fila são os singletons do chat.
 *
 * Pré-checa conversa/sessão/engine: o `SendMessageUseCase` grava sem enviar quando falta
 * engine ou `sessionId` — aqui isso vira erro, nunca SENT falso.
 *
 * Telegram com marca (IMG-15): o Telegram monta a prévia sozinho e descarta a nossa imagem, então
 * sessão Telegram + marca aplicável + foto + texto que cabe na legenda → foto marcada com o texto na
 * legenda, ignorando o `imageMode` recebido só nesse caso. A decisão é daqui, nunca do adapter.
 */
export class ChatOfferMessageSender implements IOfferMessageSender {
  constructor(
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
    private readonly deps: ChatOfferMessageSenderDeps = {},
  ) {}

  async send(input: SendOfferMessageInput): Promise<{ chatMessageId: string }> {
    const { tenantId, conversationId, text, imageUrl, imageMode, mentionAll, simulateTyping, typingSeconds } = input;

    const conv = await chatMediaContainer.conversationRepo.findById(conversationId, tenantId);
    if (!conv || !conv.sessionId) throw new OfferDestinationUnavailableError(conversationId);
    const engine = getActiveEngine();
    if (!engine) throw new SessionNotConnectedError(conv.sessionId);

    // Menção a todos só existe em grupo do WhatsApp: o Telegram ignora menções (não busca participantes)
    const wantsMentions = mentionAll && conv.isGroup && !!conv.groupJid && conv.channel !== 'telegram';
    const mentions = wantsMentions
      ? await this.groupMentions(engine, conv.sessionId, conv.groupJid!, conversationId)
      : null;

    if (simulateTyping) await this.showTyping(engine, conv, tenantId, typingSeconds);

    if (imageUrl && (await this.telegramWithMark(input, conv))) {
      try {
        return await this.sendStoredMedia(input, imageUrl, mentions, this.decorateFn(tenantId));
      } catch (err) {
        // Foto sumida do storage: segue o envio de sempre (que vira texto puro), sem falhar
        if (!(err instanceof MediaNotFoundError)) throw err;
        log.warn({ conversationId }, 'telegram watermark photo missing, sending as usual');
      }
    }

    // LINK_PREVIEW: texto com cartão de prévia (docs/mensagens-previa-de-link.md). Faltou peça = texto puro.
    const linkPreview = imageMode === 'LINK_PREVIEW' ? await this.buildLinkPreview(input) : null;

    if (imageUrl && imageMode !== 'LINK_PREVIEW') {
      // MEDIA (hoje desligado por `MEDIA_IMAGE_MODE_ENABLED`): marca só quando aplicável (IMG-08)
      const decorate = (await this.markApplies(tenantId)) ? this.decorateFn(tenantId) : undefined;
      return this.sendStoredMedia(input, imageUrl, mentions, decorate);
    }

    const message = await new SendMessageUseCase(
      chatMediaContainer.messageRepo,
      chatMediaContainer.conversationRepo,
      chatMediaContainer.contactRepo,
      engine,
      this.deps.files?.() ?? null,
      this.deps.usage?.() ?? null,
    ).execute({
      tenantId, conversationId, content: text, mentions, origin: 'AUTOMATION', ...(linkPreview ? { linkPreview } : {}),
    });
    if (!message.externalMessageId || message.status === ChatMessageStatus.FAILED) {
      throw new MessageSendFailedError('no external message id');
    }
    return { chatMessageId: message.id };
  }

  /** Foto do storage com legenda (PENDING + fila). `decorate` ausente = cópia como sempre. */
  private async sendStoredMedia(
    input: SendOfferMessageInput,
    imageUrl: string,
    mentions: string[] | null,
    decorate: ((bytes: Buffer) => Promise<Buffer>) | undefined,
  ): Promise<{ chatMessageId: string }> {
    // Menção só no job da fila: reenvio manual/recuperação sai sem marcar (ver OutboundMediaJob)
    const { message } = await chatMediaContainer.sendStoredMediaMessage().execute({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      sourceMediaUrl: imageUrl,
      mimeType: offerImageMimeFromUrl(imageUrl),
      caption: input.text,
      mentions,
      ...(decorate ? { decorate } : {}),
    });
    // FAILED aqui = fila recusou. Falha assíncrona do despacho depois de enfileirar deixa o
    // envio SENT (mensagem FAILED no chat); reconciliar por chatMessageId é trabalho futuro.
    if (message.status === ChatMessageStatus.FAILED) throw new MessageSendFailedError('media queue refused');
    return { chatMessageId: message.id };
  }

  /**
   * Ramo do Telegram com marca. O envio de mídia é assíncrono (não dá para reagir a legenda
   * recusada), então o tamanho é checado antes: não cabe → envio de sempre, sem marca, com log.
   */
  private async telegramWithMark(input: SendOfferMessageInput, conv: ChatConversation): Promise<boolean> {
    if (conv.channel !== 'telegram') return false;
    if (!(await this.markApplies(input.tenantId))) return false;
    if ([...input.text].length > TELEGRAM_CAPTION_MAX) {
      log.info({ conversationId: input.conversationId }, 'offer text exceeds telegram caption limit, sending without watermark');
      return false;
    }
    return true;
  }

  private async markApplies(tenantId: string): Promise<boolean> {
    return this.deps.decorator ? this.deps.decorator().applies(tenantId) : false;
  }

  private decorateFn(tenantId: string): (bytes: Buffer) => Promise<Buffer> {
    const decorator = this.deps.decorator!();
    return (bytes) => decorator.decorate(tenantId, bytes);
  }

  /** Link, título e imagens da prévia; qualquer um ausente → null (oferta sai como texto puro). */
  private async buildLinkPreview(input: SendOfferMessageInput): Promise<OutboundLinkPreview | null> {
    const url = pickPreviewUrl(input.text, input.affiliateUrl);
    const title = input.title?.trim() || null;
    const img = url && title && input.imageUrl ? await this.deps.previewImage?.().build(input.tenantId, input.imageUrl) ?? null : null;
    if (!url || !title || !img) {
      const reason = !url ? 'no link' : !title ? 'no title' : 'no image';
      log.info({ conversationId: input.conversationId, reason }, 'offer link preview skipped, sending plain text');
      return null;
    }
    return { url, title, description: null, thumbnailJpeg: img.thumbnailJpeg, imageJpeg: img.imageJpeg };
  }

  /**
   * "Digitando…" por `seconds` antes da oferta. Melhor esforço: falha na presença (contato
   * sumido, sessão oscilando) não segura a oferta — envia sem esperar o resto.
   */
  private async showTyping(
    engine: IMessagingEngine,
    conv: ChatConversation,
    tenantId: string,
    seconds: number,
  ): Promise<void> {
    const totalMs = Math.min(seconds, OFFER_TYPING_SECONDS_MAX) * 1000;
    if (!conv.sessionId || totalMs <= 0) return;
    let to: string | null = null;
    try {
      const contact = conv.isGroup ? null : await chatMediaContainer.contactRepo.findById(conv.contactId ?? '', tenantId);
      to = resolveConversationTarget(conv, contact).recipientPhone;
      log.info({ conversationId: conv.id, sessionId: conv.sessionId, seconds: totalMs / 1000 }, 'typing indicator start');
      for (let elapsed = 0; elapsed < totalMs; elapsed += PRESENCE_REFRESH_MS) {
        await engine.sendPresence(conv.sessionId, to, 'composing');
        await this.sleep(Math.min(PRESENCE_REFRESH_MS, totalMs - elapsed));
      }
    } catch (err) {
      log.warn({ conversationId: conv.id, err: (err as Error)?.name }, 'typing indicator failed, sending now');
    } finally {
      // Sempre encerra: o adapter devolve a presença da conta ao estado anterior aqui
      if (to) await engine.sendPresence(conv.sessionId, to, 'paused').catch(() => undefined);
    }
  }

  /**
   * JIDs dos participantes como o grupo os endereça (LID ou telefone): grupo LID (padrão no
   * Baileys 7) ignora menção por JID de telefone. Falha na consulta = envia sem menção.
   */
  private async groupMentions(
    engine: IMessagingEngine,
    sessionId: string,
    groupJid: string,
    conversationId: string,
  ): Promise<string[] | null> {
    try {
      const participants = await engine.getGroupParticipants(sessionId, groupJid);
      const jids = [...new Set(participants.map((p) => p.jid).filter((j) => !!j))];
      log.info({ conversationId, participants: participants.length, mentions: jids.length }, 'offer mention all');
      return jids.length ? jids : null;
    } catch (err) {
      log.warn({ conversationId, err: (err as Error)?.name }, 'group participants unavailable, sending without mentions');
      return null;
    }
  }
}
