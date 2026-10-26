import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { prisma } from '../../../shared/database/prisma.client';
import { env } from '../../../shared/config/env';
import { getActiveEngine } from '../../../shared/engine/activeEngine';
import { mediaContainer } from '../../media/infrastructure/mediaContainer';
import { uploadVoiceFilePath } from '../../media/infrastructure/uploads/DiskUploadSessionStore';
import { buildMediaUploadConfig } from '../../media/domain/services/mediaUploadConfig';
import type { OutboundMediaLimits } from '../../media/domain/services/classifyOutboundMedia';
import type { IMessageStatusPublisher } from '../application/contracts/IMessageStatusPublisher';
import {
  DispatchOutboundMediaUseCase,
  type FileSizeProbe,
  type TmpSpaceProbe,
} from '../application/use-cases/DispatchOutboundMediaUseCase';
import { SendStoredMediaMessageUseCase } from '../application/use-cases/SendStoredMediaMessageUseCase';
import { PrismaChatContactRepository } from './repositories/PrismaChatContactRepository';
import { PrismaChatConversationRepository } from './repositories/PrismaChatConversationRepository';
import { PrismaChatMessageRepository } from './repositories/PrismaChatMessageRepository';
import { InMemoryOutboundMediaQueue } from './queue/InMemoryOutboundMediaQueue';
import { chatWsPublisher } from './ws/ChatWebSocketPublisher';

/*
 * Composição única do envio de mídia (design §8): rotas do chat, boot e shutdown usam as
 * MESMAS instâncias. A fila guarda estado em memória (ordem por conversa, limites, `drain`):
 * duas no processo deixariam de limitar e o shutdown esperaria só uma.
 * Nada aqui toca disco, banco ou processo ao importar.
 */
const contactRepo      = new PrismaChatContactRepository(prisma);
const conversationRepo = new PrismaChatConversationRepository(prisma);
const messageRepo      = new PrismaChatMessageRepository(prisma);

/** `chat.message.status.updated` do despacho, do retry e da recuperação. */
const statusPublisher: IMessageStatusPublisher = {
  publishStatusUpdated: (event) =>
    chatWsPublisher.publish(event.tenantId, { event: 'chat.message.status.updated', data: event }),
};

/** Livre em `os.tmpdir()`: a engine grava lá a cópia criptografada antes de enviar. */
const tmpSpace: TmpSpaceProbe = async () => {
  const stats = await fs.statfs(os.tmpdir());
  return { freeBytes: stats.bavail * stats.bsize };
};

const fileSize: FileSizeProbe = async (filePath) => (await fs.stat(filePath)).size;

const queue = new InMemoryOutboundMediaQueue({
  // Despacho montado por job: o singleton da engine só existe depois do registro das rotas de
  // sessão, e quem envia é a engine ativa na hora do envio.
  run: (job) =>
    new DispatchOutboundMediaUseCase(
      messageRepo,
      conversationRepo,
      contactRepo,
      getActiveEngine(),
      mediaContainer.mediaFileStore,
      mediaContainer.mediaProcessor,
      statusPublisher,
      tmpSpace,
      fileSize,
      env.MEDIA_TMP_RESERVE_BYTES,
    ).execute(job),
  globalConcurrency:     env.MEDIA_SEND_CONCURRENCY,
  perSessionConcurrency: env.MEDIA_SEND_PER_SESSION,
  maxQueuedPerSession:   env.MEDIA_SEND_QUEUE_MAX_PER_SESSION,
});

export const chatMediaContainer = {
  contactRepo,
  conversationRepo,
  messageRepo,
  statusPublisher,
  queue,
  /** Mesmos limites que o painel recebe em `GET /media/uploads/config` (fonte única). */
  outboundLimits(): OutboundMediaLimits {
    return buildMediaUploadConfig(env, mediaContainer.capabilities()).limits;
  },
  /** Saída do transcode de voz: pasta de uploads, reconhecida pela varredura e pelo descarte. */
  voiceTmpPath(uploadId: string, ext: string): string {
    return uploadVoiceFilePath(env.MEDIA_UPLOAD_TMP_PATH, uploadId, ext);
  },
  /**
   * Envio de imagem já armazenada (gerador de ofertas). Montado a cada chamada: a engine é a
   * ativa na hora; repositórios e fila são os MESMOS singletons acima.
   */
  sendStoredMediaMessage(): SendStoredMediaMessageUseCase {
    return new SendStoredMediaMessageUseCase({
      messageRepo,
      conversationRepo,
      contactRepo,
      engine:     getActiveEngine(),
      files:      mediaContainer.mediaFileStore,
      queue,
      tmpPathFor: (ext) => path.join(os.tmpdir(), `stored-media-${randomUUID()}.${ext}`),
      copyFile:   (src, dest) => fs.copyFile(src, dest),
      removeTmp:  (filePath) => fs.rm(filePath, { force: true }),
    });
  },
};
