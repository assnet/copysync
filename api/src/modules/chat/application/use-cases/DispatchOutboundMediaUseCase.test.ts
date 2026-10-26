import { describe, it, expect, vi } from 'vitest';
import { DispatchOutboundMediaUseCase } from './DispatchOutboundMediaUseCase';
import {
  ChatMessageDirection,
  ChatMessageStatus,
  ChatMessageType,
} from '../../domain/enums/ChatMessageEnums';
import { MessageSendFailedError } from '../../../../shared/errors/internal/MessagingErrors';
import { MediaProcessingFailedError } from '../../../../shared/errors/internal/MediaErrors';
import { logger } from '../../../../shared/logger/logger';
import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import type { IMediaFileStore } from '../../../media/domain/contracts/IMediaFileStore';
import type { IMediaProcessor } from '../../../media/domain/contracts/IMediaProcessor';
import type { IMessageStatusPublisher } from '../contracts/IMessageStatusPublisher';
import type { OutboundMediaJob } from '../contracts/IOutboundMediaQueue';

vi.mock('../../../../shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const TENANT = 'tenant-1';
const CONVERSA = 'conv-1';
const NOW = new Date('2026-09-25T12:00:00.000Z');
const ARQUIVO = '/data/media/sess-1/EXT-1.jpg';
const TAMANHO = 1_000;
const RESERVA = 256 * 1024 * 1024;
const JOB: OutboundMediaJob = { messageId: 'msg-1', tenantId: TENANT, sessionId: 'sess-1', conversationId: CONVERSA };

function mensagem(over: Record<string, unknown> = {}) {
  return {
    id: 'msg-1', tenantId: TENANT, conversationId: CONVERSA,
    direction: ChatMessageDirection.OUTBOUND, type: ChatMessageType.IMAGE,
    content: 'legenda', mediaUrl: '/media/sess-1/EXT-1.jpg', mimeType: 'image/jpeg',
    fileName: null, durationSeconds: null, externalMessageId: 'EXT-1',
    status: ChatMessageStatus.PENDING, isDeleted: false, quotedMessageId: null,
    sentAt: null, fromParticipant: null, fromParticipantName: null, createdAt: NOW,
    ...over,
  };
}

function makeDeps(overrides?: {
  message?: Record<string, unknown> | null;
  conversation?: Record<string, unknown>;
  /** Outras mensagens do banco (citadas), por id. */
  outras?: Record<string, Record<string, unknown>>;
  /** `null` = a transição não ocorreu (outro caminho já avançou o status). */
  transicaoOcorre?: boolean;
  engine?: IMessagingEngine | null;
  freeBytes?: number;
}) {
  const message = overrides?.message === null ? null : mensagem(overrides?.message);
  const conversation = {
    id: CONVERSA, tenantId: TENANT, sessionId: 'sess-1',
    isGroup: false, groupJid: null, contactId: 'contact-1',
    ...overrides?.conversation,
  };
  const outras = overrides?.outras ?? {};

  const messageRepo = {
    findById: vi.fn().mockImplementation(async (id: string) => (id === 'msg-1' ? message : outras[id] ?? null)),
    transitionStatus: vi.fn().mockImplementation(
      async (id: string, _tenantId: string, _from: ChatMessageStatus[], to: ChatMessageStatus, sentAt?: Date) =>
        overrides?.transicaoOcorre === false ? null : { ...message, id, status: to, sentAt: sentAt ?? null },
    ),
  } as unknown as IChatMessageRepository;
  const conversationRepo = { findById: vi.fn().mockResolvedValue(conversation) } as unknown as IChatConversationRepository;
  const contactRepo = {
    findById: vi.fn().mockResolvedValue({ id: 'contact-1', phone: '5511999999999' }),
  } as unknown as IChatContactRepository;

  const engine = overrides?.engine === undefined
    ? ({ sendMediaMessage: vi.fn().mockResolvedValue({ messageId: 'EXT-1', sentAt: NOW }) } as unknown as IMessagingEngine)
    : overrides.engine;

  const release = vi.fn().mockResolvedValue(undefined);
  const fileStore = {
    acquireLocalFile: vi.fn().mockResolvedValue({ filePath: ARQUIVO, sizeBytes: TAMANHO, release }),
  } as unknown as IMediaFileStore;
  const processor = {
    capabilities: vi.fn().mockReturnValue({ probe: true, transcodeVoice: true }),
    probe: vi.fn().mockResolvedValue({
      durationSeconds: 12, width: 720, height: 1280,
      videoCodec: 'h264', pixelFormat: 'yuv420p', audioCodec: 'aac', hasAudio: true,
    }),
    videoThumbnailBase64: vi.fn().mockResolvedValue('MINIATURA'),
    voiceWaveform: vi.fn().mockResolvedValue(new Uint8Array([0, 50, 100])),
  } as unknown as IMediaProcessor;
  const publisher = { publishStatusUpdated: vi.fn() } as IMessageStatusPublisher;
  const tmpSpace = vi.fn().mockResolvedValue({ freeBytes: overrides?.freeBytes ?? 10 * 1024 ** 3 });
  const fileSize = vi.fn().mockResolvedValue(TAMANHO);

  const useCase = new DispatchOutboundMediaUseCase(
    messageRepo, conversationRepo, contactRepo, engine, fileStore, processor, publisher,
    tmpSpace, fileSize, RESERVA, () => NOW,
  );
  return {
    useCase, messageRepo, conversationRepo, contactRepo, engine, fileStore, processor, publisher, tmpSpace, fileSize, release,
  };
}

type Deps = ReturnType<typeof makeDeps>;

const enviado = (d: Deps) => vi.mocked(d.engine!.sendMediaMessage).mock.calls[0][0];

function esperaFalha(d: Deps) {
  expect(d.messageRepo.transitionStatus).toHaveBeenCalledWith(
    'msg-1', TENANT, [ChatMessageStatus.PENDING], ChatMessageStatus.FAILED,
  );
  expect(d.messageRepo.transitionStatus).toHaveBeenCalledTimes(1);
  expect(d.publisher.publishStatusUpdated).toHaveBeenCalledWith({
    tenantId: TENANT, conversationId: CONVERSA, messageId: 'msg-1', status: ChatMessageStatus.FAILED,
  });
}

describe('DispatchOutboundMediaUseCase', () => {
  it.each([
    ['já enviada', { status: ChatMessageStatus.SENT }],
    ['já entregue', { status: ChatMessageStatus.DELIVERED }],
    ['com falha (aguarda reenvio)', { status: ChatMessageStatus.FAILED }],
  ])('mensagem %s: não envia, não muda status nem publica', async (_nome, over) => {
    const d = makeDeps({ message: over });
    await d.useCase.execute(JOB);

    expect(d.engine!.sendMediaMessage).not.toHaveBeenCalled();
    expect(d.messageRepo.transitionStatus).not.toHaveBeenCalled();
    expect(d.publisher.publishStatusUpdated).not.toHaveBeenCalled();
  });

  it('mensagem que não existe mais: não envia nem publica', async () => {
    const d = makeDeps({ message: null });
    await d.useCase.execute(JOB);

    expect(d.engine!.sendMediaMessage).not.toHaveBeenCalled();
    expect(d.messageRepo.transitionStatus).not.toHaveBeenCalled();
    expect(d.publisher.publishStatusUpdated).not.toHaveBeenCalled();
  });

  it('sucesso: envia com o id já gravado, marca SENT com a hora do envio e publica', async () => {
    const d = makeDeps();
    await d.useCase.execute(JOB);

    expect(enviado(d)).toEqual({
      sessionId: 'sess-1', tenantId: TENANT, to: '5511999999999', messageId: 'EXT-1',
      media: expect.objectContaining({
        kind: 'image', filePath: ARQUIVO, mimeType: 'image/jpeg', caption: 'legenda', sizeBytes: TAMANHO,
      }),
      quotedMessage: null,
    });
    expect(d.fileStore.acquireLocalFile).toHaveBeenCalledWith('/media/sess-1/EXT-1.jpg');
    expect(d.release).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.release).mock.invocationCallOrder[0])
      .toBeGreaterThan(vi.mocked(d.engine!.sendMediaMessage).mock.invocationCallOrder[0]);
    expect(d.processor.probe).not.toHaveBeenCalled();
    expect(d.messageRepo.transitionStatus).toHaveBeenCalledWith(
      'msg-1', TENANT, [ChatMessageStatus.PENDING], ChatMessageStatus.SENT, NOW,
    );
    expect(d.publisher.publishStatusUpdated).toHaveBeenCalledWith({
      tenantId: TENANT, conversationId: CONVERSA, messageId: 'msg-1', status: ChatMessageStatus.SENT,
    });
  });

  it('transição não ocorre (DELIVERED chegou antes do SENT): não publica', async () => {
    const d = makeDeps({ transicaoOcorre: false });
    await d.useCase.execute(JOB);

    expect(d.engine!.sendMediaMessage).toHaveBeenCalledTimes(1);
    expect(d.messageRepo.transitionStatus).toHaveBeenCalledTimes(1);
    expect(d.publisher.publishStatusUpdated).not.toHaveBeenCalled();
  });

  it.each<[string, (d: Deps) => void, Parameters<typeof makeDeps>[0]?]>([
    ['probe do vídeo lança', (d) => {
      vi.mocked(d.processor.probe).mockRejectedValue(new MediaProcessingFailedError());
    }, { message: { type: ChatMessageType.VIDEO, mimeType: 'video/mp4' } }],
    ['arquivo ausente ou mediaUrl fora do store', (d) => {
      vi.mocked(d.fileStore.acquireLocalFile).mockResolvedValue(null);
    }],
    ['mensagem sem mediaUrl', () => {}, { message: { mediaUrl: null } }],
    ['/tmp sem folga para o arquivo e a reserva', () => {}, { freeBytes: TAMANHO + RESERVA - 1 }],
    ['arquivo não materializa (leitura/download falha)', (d) => {
      vi.mocked(d.fileStore.acquireLocalFile).mockRejectedValue(new Error('EACCES'));
    }],
    ['repositório lança ao carregar a conversa', (d) => {
      vi.mocked(d.conversationRepo.findById).mockRejectedValue(new Error('conexão perdida'));
    }],
    ['repositório lança ao carregar a mensagem', (d) => {
      vi.mocked(d.messageRepo.findById).mockRejectedValue(new Error('conexão perdida'));
    }],
    ['tipo de mensagem que não é mídia enviável', () => {}, { message: { type: ChatMessageType.STICKER } }],
    ['sem engine ativa', () => {}, { engine: null }],
  ])('%s: marca FAILED, publica e não chama a engine', async (_nome, prepara, over) => {
    const d = makeDeps(over);
    prepara(d);

    await expect(d.useCase.execute(JOB)).resolves.toBeUndefined();

    if (d.engine) expect(d.engine.sendMediaMessage).not.toHaveBeenCalled();
    esperaFalha(d);
  });

  it.each<[string, (d: Deps) => void, Parameters<typeof makeDeps>[0]?]>([
    ['probe do vídeo lança', (d) => {
      vi.mocked(d.processor.probe).mockRejectedValue(new MediaProcessingFailedError());
    }, { message: { type: ChatMessageType.VIDEO, mimeType: 'video/mp4' } }],
    ['/tmp sem folga', () => {}, { freeBytes: TAMANHO + RESERVA - 1 }],
    ['engine lança', (d) => {
      vi.mocked(d.engine!.sendMediaMessage).mockRejectedValue(new MessageSendFailedError('socket caiu'));
    }],
  ])('%s depois de obter o arquivo: libera o arquivo e marca FAILED', async (_nome, prepara, over) => {
    const d = makeDeps(over);
    prepara(d);

    await expect(d.useCase.execute(JOB)).resolves.toBeUndefined();

    expect(d.release).toHaveBeenCalledTimes(1);
    esperaFalha(d);
  });

  it.each<[string, (d: Deps) => void, Parameters<typeof makeDeps>[0]?]>([
    ['arquivo não obtido', (d) => { vi.mocked(d.fileStore.acquireLocalFile).mockResolvedValue(null); }],
    ['mensagem sem mediaUrl', () => {}, { message: { mediaUrl: null } }],
  ])('%s: não há o que liberar', async (_nome, prepara, over) => {
    const d = makeDeps(over);
    prepara(d);
    await d.useCase.execute(JOB);

    expect(d.release).not.toHaveBeenCalled();
    if (over?.message) expect(d.fileStore.acquireLocalFile).not.toHaveBeenCalled();
  });

  it('release que lança: marca FAILED sem lançar para a fila', async () => {
    const d = makeDeps();
    vi.mocked(d.release).mockRejectedValue(new Error('unlink falhou'));

    await expect(d.useCase.execute(JOB)).resolves.toBeUndefined();
    esperaFalha(d);
  });

  it('/tmp com exatamente o arquivo mais a reserva: envia', async () => {
    const d = makeDeps({ freeBytes: TAMANHO + RESERVA });
    await d.useCase.execute(JOB);

    expect(d.engine!.sendMediaMessage).toHaveBeenCalledTimes(1);
  });

  it('/tmp sem folga: registra os números no log', async () => {
    const d = makeDeps({ freeBytes: 10 });
    await d.useCase.execute(JOB);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ freeBytes: 10, sizeBytes: TAMANHO, reserveBytes: RESERVA }),
      expect.any(String),
    );
  });

  it('erro da engine: marca FAILED e publica, sem lançar para a fila', async () => {
    const engine = {
      sendMediaMessage: vi.fn().mockRejectedValue(new MessageSendFailedError('socket caiu')),
    } as unknown as IMessagingEngine;
    const d = makeDeps({ engine });

    await expect(d.useCase.execute(JOB)).resolves.toBeUndefined();
    esperaFalha(d);
  });

  it('falha ao gravar ou publicar o status não lança para a fila', async () => {
    const d = makeDeps();
    vi.mocked(d.messageRepo.transitionStatus).mockRejectedValue(new Error('conexão perdida'));
    await expect(d.useCase.execute(JOB)).resolves.toBeUndefined();

    const e = makeDeps();
    vi.mocked(e.publisher.publishStatusUpdated).mockImplementation(() => { throw new Error('ws fora'); });
    await expect(e.useCase.execute(JOB)).resolves.toBeUndefined();
  });

  it('vídeo leva duração, dimensões e miniatura lidas do arquivo final', async () => {
    const d = makeDeps({ message: { type: ChatMessageType.VIDEO, mimeType: 'video/mp4', durationSeconds: 3 } });
    await d.useCase.execute(JOB);

    expect(d.processor.probe).toHaveBeenCalledWith(ARQUIVO, 'mov');
    expect(d.processor.videoThumbnailBase64).toHaveBeenCalledWith(ARQUIVO);
    expect(enviado(d).media).toMatchObject({
      kind: 'video', durationSeconds: 12, width: 720, height: 1280, thumbnailJpegBase64: 'MINIATURA',
    });
  });

  it('miniatura que falha não impede o envio do vídeo', async () => {
    const d = makeDeps({ message: { type: ChatMessageType.VIDEO, mimeType: 'video/mp4' } });
    vi.mocked(d.processor.videoThumbnailBase64).mockRejectedValue(new Error('ffmpeg caiu'));
    await d.useCase.execute(JOB);

    expect(enviado(d).media).toMatchObject({ kind: 'video', durationSeconds: 12, thumbnailJpegBase64: null });
    expect(d.messageRepo.transitionStatus).toHaveBeenCalledWith(
      'msg-1', TENANT, [ChatMessageStatus.PENDING], ChatMessageStatus.SENT, NOW,
    );
  });

  it('voz leva duração e forma de onda da nota Ogg', async () => {
    const d = makeDeps({ message: { type: ChatMessageType.AUDIO, mimeType: 'audio/ogg; codecs=opus', content: null } });
    vi.mocked(d.processor.probe).mockResolvedValue({
      durationSeconds: 7, width: null, height: null,
      videoCodec: null, pixelFormat: null, audioCodec: 'opus', hasAudio: true,
    });
    await d.useCase.execute(JOB);

    expect(d.processor.probe).toHaveBeenCalledWith(ARQUIVO, 'ogg');
    expect(d.processor.voiceWaveform).toHaveBeenCalledWith(ARQUIVO);
    expect(enviado(d).media).toMatchObject({
      kind: 'voice', mimeType: 'audio/ogg; codecs=opus', durationSeconds: 7, waveform: new Uint8Array([0, 50, 100]),
    });
  });

  it('forma de onda que falha não impede o envio da voz', async () => {
    const d = makeDeps({ message: { type: ChatMessageType.AUDIO, mimeType: 'audio/ogg; codecs=opus' } });
    vi.mocked(d.processor.voiceWaveform).mockRejectedValue(new Error('ffmpeg caiu'));
    await d.useCase.execute(JOB);

    expect(enviado(d).media).toMatchObject({ kind: 'voice', waveform: null });
    expect(d.publisher.publishStatusUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ status: ChatMessageStatus.SENT }),
    );
  });

  it('documento vai com o nome do arquivo e sem probe', async () => {
    const d = makeDeps({
      message: { type: ChatMessageType.DOCUMENT, mimeType: 'application/pdf', fileName: 'contrato.pdf', content: null },
    });
    await d.useCase.execute(JOB);

    expect(d.processor.probe).not.toHaveBeenCalled();
    expect(enviado(d).media).toMatchObject({ kind: 'document', fileName: 'contrato.pdf', mimeType: 'application/pdf' });
  });

  it('grupo envia para o JID @g.us, sem buscar contato', async () => {
    const d = makeDeps({ conversation: { isGroup: true, groupJid: '120363000000000001', contactId: null } });
    await d.useCase.execute(JOB);

    expect(enviado(d).to).toBe('120363000000000001@g.us');
    expect(d.contactRepo.findById).not.toHaveBeenCalled();
  });

  it('citação da mesma conversa em grupo vai com o autor (participant)', async () => {
    const d = makeDeps({
      conversation: { isGroup: true, groupJid: '120363000000000001', contactId: null },
      message: { quotedMessageId: 'msg-citada' },
      outras: {
        'msg-citada': mensagem({
          id: 'msg-citada', direction: ChatMessageDirection.INBOUND, type: ChatMessageType.TEXT,
          content: 'pergunta', externalMessageId: 'EXT-CITADA', fromParticipant: '5511888888888@s.whatsapp.net',
          mediaUrl: null, mimeType: null,
        }),
      },
    });
    await d.useCase.execute(JOB);

    expect(enviado(d).quotedMessage).toMatchObject({
      externalId: 'EXT-CITADA', remoteJid: '120363000000000001@g.us', fromMe: false,
      participant: '5511888888888@s.whatsapp.net',
    });
  });

  it('citação de outra conversa não vai, e a mídia é enviada sem ela', async () => {
    const d = makeDeps({
      message: { quotedMessageId: 'msg-alheia' },
      outras: { 'msg-alheia': mensagem({ id: 'msg-alheia', conversationId: 'conv-outra', externalMessageId: 'EXT-ALHEIA' }) },
    });
    await d.useCase.execute(JOB);

    expect(enviado(d).quotedMessage).toBeNull();
    expect(d.publisher.publishStatusUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ status: ChatMessageStatus.SENT }),
    );
  });
});
