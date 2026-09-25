import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { ChatMessage } from '../../domain/entities/ChatMessage';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import type {
  IUploadSessionStore,
  UploadSessionRecord,
} from '../../../media/domain/contracts/IUploadSessionStore';
import type { IMediaProcessor } from '../../../media/domain/contracts/IMediaProcessor';
import type { IMediaFileStore, PromotedMediaFile } from '../../../media/domain/contracts/IMediaFileStore';
import type { IOutboundMediaQueue } from '../contracts/IOutboundMediaQueue';
import {
  ChatMessageDirection,
  ChatMessageStatus,
  ChatMessageType,
} from '../../domain/enums/ChatMessageEnums';
import { buildMessagePreview } from '../../domain/services/buildMessagePreview';
import { sniffMediaType, type MediaDemuxer } from '../../../media/domain/services/sniffMediaType';
import {
  classifyOutboundMedia,
  type OutboundMediaKind,
  type OutboundMediaLimits,
} from '../../../media/domain/services/classifyOutboundMedia';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { SessionNotConnectedError } from '../../../../shared/errors/internal/SessionErrors';
import {
  MediaProcessorUnavailableError,
  UnsupportedMediaTypeError,
  UploadIncompleteError,
  UploadInProgressError,
  UploadNotFoundError,
} from '../../../../shared/errors/internal/MediaErrors';
import { logger } from '../../../../shared/logger/logger';
import { resolveConversationTarget } from './resolveConversationTarget';
import type { ChatMessageDto } from './ListMessagesUseCase';

export interface SendMediaMessageInput {
  tenantId: string;
  userId: string;
  conversationId: string;
  uploadId: string;
  caption?: string | null;
  quotedMessageId?: string | null;
}

export interface SendMediaMessageOutput {
  message: ChatMessageDto;
  /** Confirmação repetida do mesmo upload: a rota responde 200 em vez de 202. */
  replayed: boolean;
}

export interface SendMediaMessageDeps {
  messageRepo: IChatMessageRepository;
  conversationRepo: IChatConversationRepository;
  contactRepo: IChatContactRepository;
  engine: IMessagingEngine | null;
  uploads: IUploadSessionStore;
  processor: IMediaProcessor;
  files: IMediaFileStore;
  queue: IOutboundMediaQueue;
  limits: OutboundMediaLimits;
  /** Caminho na pasta temporária (mesmo disco da mídia) para a saída do transcode. */
  tmpPathFor: (uploadId: string, ext: string) => string;
}

/** Arquivo pronto e promovido, com o que a mensagem precisa gravar. */
interface PreparedMedia {
  sessionId: string;
  externalMessageId: string;
  type: ChatMessageType;
  mimeType: string;
  durationSeconds: number | null;
  file: PromotedMediaFile;
}

const SNIFF_BYTES = 4096;

const TYPE_BY_KIND: Record<OutboundMediaKind, ChatMessageType> = {
  image:    ChatMessageType.IMAGE,
  video:    ChatMessageType.VIDEO,
  voice:    ChatMessageType.AUDIO,
  document: ChatMessageType.DOCUMENT,
};

/**
 * Confirma um upload como mensagem de mídia (design §8). Grava `PENDING` com o id externo
 * pré-gerado e enfileira; quem envia ao WhatsApp é o despacho da fila.
 *
 * Ordem importa: sessão antes de processar (nunca grava sem poder enviar); promoção antes de
 * gravar; gravar antes de enfileirar. Até a promoção, qualquer erro devolve o upload a `OPEN`
 * (o painel tenta de novo sem subir o arquivo); depois dela, só falha de banco desfaz tudo.
 */
export class SendMediaMessageUseCase {
  constructor(private readonly deps: SendMediaMessageDeps) {}

  async execute(input: SendMediaMessageInput): Promise<SendMediaMessageOutput> {
    const { tenantId, userId, conversationId, uploadId } = input;
    const { messageRepo, conversationRepo, contactRepo, uploads, files, queue } = this.deps;

    // 1. Conversa do tenant com destino válido (grupo com JID, individual com contato)
    const conv = await conversationRepo.findById(conversationId, tenantId);
    if (!conv) throw new NotFoundError('Conversation', conversationId);
    const contact = conv.isGroup ? null : await contactRepo.findById(conv.contactId ?? '', tenantId);
    resolveConversationTarget(conv, contact);
    // Leitura antes de reservar: depois da promoção, uma falha aqui deixaria arquivo órfão
    const quoted = await this.findQuoted(input);

    // 2. Reserva o upload; confirmação repetida devolve a mensagem já gravada (MEDIA-29)
    const begun = await uploads.beginConsume(uploadId, tenantId, userId);
    if (begun.outcome === 'consumed') {
      return { message: await this.replay(begun.messageId, input), replayed: true };
    }
    if (begun.outcome === 'in_progress') throw new UploadInProgressError(undefined, { uploadId });
    if (begun.outcome === 'incomplete') throw new UploadIncompleteError(undefined, { uploadId });
    if (begun.outcome === 'not_found') throw new UploadNotFoundError(undefined, { uploadId });

    // 3–6. Sessão, classificação, voz e promoção
    let prepared: PreparedMedia;
    try {
      prepared = await this.prepare(conv.sessionId, conv.id, begun.record);
    } catch (err) {
      await this.quietly('Falha ao devolver upload após erro no envio de mídia', uploadId, () =>
        uploads.releaseConsume(uploadId),
      );
      throw err;
    }

    // 7. Grava PENDING. Só falha de banco chega aqui: desfaz arquivo e upload (painel sobe de novo)
    const caption = input.caption || null;
    let message: ChatMessage;
    try {
      message = await messageRepo.create({
        tenantId,
        conversationId,
        direction:         ChatMessageDirection.OUTBOUND,
        type:              prepared.type,
        content:           caption,
        mediaUrl:          prepared.file.publicUrl,
        mimeType:          prepared.mimeType,
        fileName:          prepared.type === ChatMessageType.DOCUMENT ? begun.record.fileName : null,
        durationSeconds:   prepared.durationSeconds,
        quotedMessageId:   quoted?.id ?? null,
        externalMessageId: prepared.externalMessageId,
        status:            ChatMessageStatus.PENDING,
      });
    } catch (err) {
      await this.quietly('Falha ao apagar mídia promovida', uploadId, () => files.remove(prepared.file.localPath));
      await this.quietly('Falha ao descartar upload', uploadId, () => uploads.discard(uploadId));
      throw err;
    }

    // 8–9. Mensagem já existe: falha aqui não pode impedir o envio (reconciliação cobre o lateral)
    await this.quietly('Falha ao concluir upload', uploadId, () => uploads.finishConsume(uploadId, message.id));
    await this.quietly('Falha ao atualizar prévia da conversa', uploadId, () =>
      conversationRepo.updateLastMessage(conversationId, tenantId, {
        lastMessagePreview: buildMessagePreview(prepared.type, caption),
        lastMessageAt:      message.createdAt,
      }),
    );

    // 10. Enfileira; recusa (fila cheia ou em drain) vira FAILED reenviável
    const accepted = queue.enqueue({
      messageId: message.id, tenantId, sessionId: prepared.sessionId, conversationId,
    });
    if (!accepted) {
      logger.warn({ messageId: message.id, sessionId: prepared.sessionId }, 'Fila de mídia recusou o envio');
      const failed = await messageRepo.transitionStatus(
        message.id, tenantId, [ChatMessageStatus.PENDING], ChatMessageStatus.FAILED,
      );
      message = failed ?? message;
    }

    // 11. Mesmo DTO do texto
    return { message: toDto(message, quoted), replayed: false };
  }

  /** Passos 3 a 6. Qualquer erro aqui devolve o upload a `OPEN` (quem chama faz). */
  private async prepare(
    sessionId: string | null,
    conversationId: string,
    record: UploadSessionRecord,
  ): Promise<PreparedMedia> {
    const { engine, uploads, processor, files, limits } = this.deps;
    const { uploadId } = record;

    // 3. Sem sessão conectada, recusa antes de gravar (nada de "grava sem enviar")
    if (!engine || !sessionId) throw new SessionNotConnectedError(sessionId ?? conversationId);
    const externalMessageId = engine.createOutboundMessageId(sessionId);
    await uploads.setExternalId(uploadId, externalMessageId);

    // Voz depende do ffmpeg (transcode) e do ffprobe (há áudio? duração)
    const caps = processor.capabilities();
    if (record.purpose === 'voice' && !(caps.transcodeVoice && caps.probe)) {
      throw new MediaProcessorUnavailableError('Voice notes are unavailable on this server');
    }

    // 4. Tipo pelo conteúdo → probe (só com demuxer) → classificação
    const srcPath = uploads.binPath(uploadId);
    const head = await uploads.readHead(uploadId, SNIFF_BYTES);
    if (!srcPath || !head) throw new UploadNotFoundError(undefined, { uploadId });
    const sniffed = sniffMediaType(head, record.declaredMimeType);
    const probe = sniffed.demuxer && caps.probe ? await processor.probe(srcPath, sniffed.demuxer) : null;
    const { kind, mimeType } = classifyOutboundMedia({
      purpose: record.purpose, sniffed, sizeBytes: record.sizeBytes, probe, limits,
    });
    const target = { sessionId, externalMessageId, mimeType };

    // 5–6. Voz vira Ogg/Opus antes de promover; o resto promove o próprio upload
    if (kind === 'voice') {
      if (!sniffed.demuxer) throw new UnsupportedMediaTypeError('Voice notes must be an audio recording');
      const voice = await this.transcodeAndPromoteVoice(uploadId, srcPath, sniffed.demuxer, target);
      return { ...target, type: ChatMessageType.AUDIO, ...voice };
    }
    const file = await files.promote({ srcPath, ...target });
    return {
      ...target,
      type: TYPE_BY_KIND[kind],
      durationSeconds: kind === 'video' ? probe?.durationSeconds ?? null : null,
      file,
    };
  }

  /** Transcodifica, lê a duração da saída e promove; a saída parcial é apagada se algo falhar. */
  private async transcodeAndPromoteVoice(
    uploadId: string,
    srcPath: string,
    demuxer: MediaDemuxer,
    target: { sessionId: string; externalMessageId: string; mimeType: string },
  ): Promise<{ durationSeconds: number | null; file: PromotedMediaFile }> {
    const { processor, files, tmpPathFor } = this.deps;
    const outPath = tmpPathFor(uploadId, 'ogg');
    try {
      await processor.transcodeVoiceNote(srcPath, demuxer, outPath);
      const { durationSeconds } = await processor.probe(outPath, 'ogg');
      const file = await files.promote({ srcPath: outPath, ...target });
      return { durationSeconds, file };
    } catch (err) {
      await this.quietly('Falha ao apagar nota de voz transcodificada', uploadId, () => files.remove(outPath));
      throw err;
    }
  }

  /** Upload já consumido: devolve a mensagem, desde que seja desta conversa. */
  private async replay(messageId: string, input: SendMediaMessageInput): Promise<ChatMessageDto> {
    const { messageRepo } = this.deps;
    const message = await messageRepo.findById(messageId, input.tenantId);
    if (!message || message.conversationId !== input.conversationId) {
      throw new UploadNotFoundError(undefined, { uploadId: input.uploadId });
    }
    const quoted = message.quotedMessageId
      ? await messageRepo.findById(message.quotedMessageId, input.tenantId)
      : null;
    return toDto(message, quoted);
  }

  /**
   * Mesma guarda do texto: só vincula a citada encontrada **nesta** conversa — o `create`
   * resolveria o id por `externalMessageId` em todo o tenant e ligaria a outro chat.
   */
  private async findQuoted(input: SendMediaMessageInput): Promise<ChatMessage | null> {
    if (!input.quotedMessageId) return null;
    const found = await this.deps.messageRepo.findById(input.quotedMessageId, input.tenantId);
    if (found && found.conversationId === input.conversationId) return found;
    logger.warn(
      { conversationId: input.conversationId, quotedMessageId: input.quotedMessageId, found: !!found },
      'Quoted message not found in this conversation — sending media without quote',
    );
    return null;
  }

  /** Limpeza/efeito secundário: registra a falha sem trocar o erro (ou o sucesso) principal. */
  private async quietly(message: string, uploadId: string, action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (err) {
      logger.error({ err, uploadId }, message);
    }
  }
}

function toDto(message: ChatMessage, quoted: ChatMessage | null): ChatMessageDto {
  return {
    id:                message.id,
    conversationId:    message.conversationId,
    tenantId:          message.tenantId,
    direction:         message.direction,
    type:              message.type,
    content:           message.content,
    mediaUrl:          message.mediaUrl,
    mimeType:          message.mimeType,
    fileName:          message.fileName,
    durationSeconds:   message.durationSeconds,
    externalMessageId: message.externalMessageId,
    status:            message.status,
    isDeleted:         message.isDeleted,
    quotedMessageId:   message.quotedMessageId,
    quotedMessage:     quoted
      ? {
          id:        quoted.id,
          type:      quoted.type,
          content:   quoted.content,
          mediaUrl:  quoted.mediaUrl,
          direction: quoted.direction,
          isDeleted: quoted.isDeleted,
        }
      : null,
    sentAt:            message.sentAt?.toISOString() ?? null,
    createdAt:         message.createdAt.toISOString(),
    fromParticipant:     message.fromParticipant,
    fromParticipantName: message.fromParticipantName,
    // Mensagem enviada por nós: não há avatar de participante de grupo.
    fromParticipantAvatarUrl: null,
    // Mensagem recém-enviada ainda não tem reações (reação é recusada em PENDING/FAILED).
    reactionsRevision: null,
    reactions:         [],
  };
}
