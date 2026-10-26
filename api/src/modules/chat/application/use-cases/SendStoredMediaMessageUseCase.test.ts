import { describe, it, expect, vi } from 'vitest';
import { SendStoredMediaMessageUseCase } from './SendStoredMediaMessageUseCase';
import {
  ChatMessageDirection,
  ChatMessageStatus,
  ChatMessageType,
} from '../../domain/enums/ChatMessageEnums';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { SessionNotConnectedError } from '../../../../shared/errors/internal/SessionErrors';
import { MediaNotFoundError, UnsupportedMediaTypeError } from '../../../../shared/errors/internal/MediaErrors';
import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import type { IMediaFileStore } from '../../../media/domain/contracts/IMediaFileStore';
import type { IOutboundMediaQueue } from '../contracts/IOutboundMediaQueue';

const TENANT = 'tenant-1';
const CONVERSA = 'conv-1';
const SESSAO = 'sess-1';
const EXT = 'EXT-1';
const SRC_URL = '/api/storage/media/oferta.jpg';
const SRC_PATH = '/media/oferta.jpg';
const TMP = '/tmp/stored-media-x.jpg';
const NOW = new Date('2026-10-26T12:00:00.000Z');

function makeDeps(o: {
  engine?: IMessagingEngine | null;
  sessionId?: string | null;
  acquired?: boolean;
  createError?: Error;
  promoteError?: Error;
  enqueued?: boolean;
} = {}) {
  const release = vi.fn(async () => undefined);
  const messageRepo = {
    create: vi.fn(async (data: Record<string, unknown>) => ({
      id: 'msg-nova', isDeleted: false, sentAt: null, fromParticipant: null,
      fromParticipantName: null, createdAt: NOW, ...data,
    })),
    transitionStatus: vi.fn(async (_id: string, _t: string, _f: ChatMessageStatus[], to: ChatMessageStatus) => {
      const saved = await messageRepo.create.mock.results[0].value;
      return { ...saved, status: to };
    }),
  };
  if (o.createError) messageRepo.create.mockRejectedValueOnce(o.createError);
  const conversationRepo = {
    findById: vi.fn().mockResolvedValue({
      id: CONVERSA, tenantId: TENANT, sessionId: o.sessionId === undefined ? SESSAO : o.sessionId,
      isGroup: false, groupJid: null, contactId: 'contact-1',
    }),
    updateLastMessage: vi.fn(async () => undefined),
  };
  const contactRepo = { findById: vi.fn().mockResolvedValue({ id: 'contact-1', phone: '5511999999999' }) };
  const engine = o.engine === undefined
    ? ({ createOutboundMessageId: vi.fn(() => EXT) } as unknown as IMessagingEngine)
    : o.engine;
  const files = {
    acquireLocalFile: vi.fn(async () =>
      o.acquired === false ? null : { filePath: SRC_PATH, sizeBytes: 1_000, release }),
    promote: vi.fn(async () => {
      if (o.promoteError) throw o.promoteError;
      return { publicUrl: '/api/storage/media/sess-1_EXT-1.jpg', localPath: '/media/sess-1_EXT-1.jpg', sizeBytes: 1_000 };
    }),
    remove: vi.fn(async () => undefined),
  };
  const queue = { enqueue: vi.fn(() => o.enqueued ?? true), inFlightIds: vi.fn(() => []), drain: vi.fn() };
  const copyFile = vi.fn(async () => undefined);
  const removeTmp = vi.fn(async () => undefined);
  const tmpPathFor = vi.fn(() => TMP);

  const useCase = new SendStoredMediaMessageUseCase({
    messageRepo: messageRepo as unknown as IChatMessageRepository,
    conversationRepo: conversationRepo as unknown as IChatConversationRepository,
    contactRepo: contactRepo as unknown as IChatContactRepository,
    engine,
    files: files as unknown as IMediaFileStore,
    queue: queue as unknown as IOutboundMediaQueue,
    tmpPathFor,
    copyFile,
    removeTmp,
  });
  return { useCase, messageRepo, conversationRepo, files, queue, copyFile, removeTmp, release };
}

type Deps = ReturnType<typeof makeDeps>;
const enviar = (d: Deps, over: { mimeType?: string; caption?: string | null; mentions?: string[] | null } = {}) =>
  d.useCase.execute({
    tenantId: TENANT, conversationId: CONVERSA, sourceMediaUrl: SRC_URL,
    mimeType: 'image/jpeg', caption: 'Oferta!', ...over,
  });

describe('SendStoredMediaMessageUseCase', () => {
  it('copia a origem, promove a cópia, grava PENDING e enfileira', async () => {
    const d = makeDeps();
    const { message } = await enviar(d);

    expect(d.copyFile).toHaveBeenCalledWith(SRC_PATH, TMP);
    const promoted = d.files.promote.mock.calls[0] as unknown as [{ srcPath: string }];
    expect(promoted[0]).toEqual({ srcPath: TMP, sessionId: SESSAO, externalMessageId: EXT, mimeType: 'image/jpeg' });
    expect(promoted[0].srcPath).not.toBe(SRC_PATH);
    expect(d.messageRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT, conversationId: CONVERSA, direction: ChatMessageDirection.OUTBOUND,
      type: ChatMessageType.IMAGE, content: 'Oferta!', mediaUrl: '/api/storage/media/sess-1_EXT-1.jpg',
      mimeType: 'image/jpeg', externalMessageId: EXT, status: ChatMessageStatus.PENDING,
    }));
    expect(d.queue.enqueue).toHaveBeenCalledWith({
      messageId: 'msg-nova', tenantId: TENANT, sessionId: SESSAO, conversationId: CONVERSA,
    });
    expect(d.conversationRepo.updateLastMessage).toHaveBeenCalled();
    expect(d.release).toHaveBeenCalledOnce();
    expect(d.files.remove).not.toHaveBeenCalledWith(SRC_PATH);
    expect(message.status).toBe(ChatMessageStatus.PENDING);
    expect(message.quotedMessage).toBeNull();
  });

  it('menções seguem no job da fila (não são gravadas na mensagem)', async () => {
    const d = makeDeps();
    await enviar(d, { mentions: ['5511999990001', '5511999990002'] });
    expect(d.queue.enqueue).toHaveBeenCalledWith({
      messageId: 'msg-nova', tenantId: TENANT, sessionId: SESSAO, conversationId: CONVERSA,
      mentions: ['5511999990001', '5511999990002'],
    });
    expect(d.messageRepo.create).toHaveBeenCalledWith(expect.not.objectContaining({ mentions: expect.anything() }));
  });

  it('lista de menções vazia não vai ao job', async () => {
    const d = makeDeps();
    await enviar(d, { mentions: [] });
    expect(d.queue.enqueue).toHaveBeenCalledWith({
      messageId: 'msg-nova', tenantId: TENANT, sessionId: SESSAO, conversationId: CONVERSA,
    });
  });

  it('sem engine ou sessão recusa com SessionNotConnectedError antes de tocar a mídia', async () => {
    for (const d of [makeDeps({ engine: null }), makeDeps({ sessionId: null })]) {
      await expect(enviar(d)).rejects.toBeInstanceOf(SessionNotConnectedError);
      expect(d.files.acquireLocalFile).not.toHaveBeenCalled();
      expect(d.messageRepo.create).not.toHaveBeenCalled();
    }
  });

  it('origem ausente vira MediaNotFoundError e nada é gravado', async () => {
    const d = makeDeps({ acquired: false });
    await expect(enviar(d)).rejects.toBeInstanceOf(MediaNotFoundError);
    expect(d.files.promote).not.toHaveBeenCalled();
    expect(d.messageRepo.create).not.toHaveBeenCalled();
  });

  it('tipo que não é imagem recusa com 415', async () => {
    const d = makeDeps();
    const err = await enviar(d, { mimeType: 'video/mp4' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnsupportedMediaTypeError);
    expect((err as UnsupportedMediaTypeError).statusCode).toBe(415);
    expect(d.conversationRepo.findById).not.toHaveBeenCalled();
  });

  it('fila recusa → mensagem vira FAILED', async () => {
    const d = makeDeps({ enqueued: false });
    const { message } = await enviar(d);
    expect(d.messageRepo.transitionStatus).toHaveBeenCalledWith(
      'msg-nova', TENANT, [ChatMessageStatus.PENDING], ChatMessageStatus.FAILED,
    );
    expect(message.status).toBe(ChatMessageStatus.FAILED);
  });

  it('falha na promoção libera a origem e apaga a cópia temporária', async () => {
    const d = makeDeps({ promoteError: new Error('disk') });
    await expect(enviar(d)).rejects.toThrow('disk');
    expect(d.release).toHaveBeenCalledOnce();
    expect(d.removeTmp).toHaveBeenCalledWith(TMP);
  });

  it('falha de banco apaga o arquivo promovido e libera a origem', async () => {
    const d = makeDeps({ createError: new Error('db') });
    await expect(enviar(d)).rejects.toThrow('db');
    expect(d.files.remove).toHaveBeenCalledWith('/media/sess-1_EXT-1.jpg');
    expect(d.release).toHaveBeenCalledOnce();
    expect(d.queue.enqueue).not.toHaveBeenCalled();
  });
});
