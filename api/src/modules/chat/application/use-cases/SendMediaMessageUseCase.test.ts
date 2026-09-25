import { describe, it, expect, vi } from 'vitest';
import { SendMediaMessageUseCase } from './SendMediaMessageUseCase';
import {
  ChatMessageDirection,
  ChatMessageStatus,
  ChatMessageType,
} from '../../domain/enums/ChatMessageEnums';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { SessionNotConnectedError } from '../../../../shared/errors/internal/SessionErrors';
import {
  MediaProcessingFailedError,
  MediaProcessorUnavailableError,
  MediaTooLargeError,
  UploadIncompleteError,
  UploadInProgressError,
  UploadNotFoundError,
} from '../../../../shared/errors/internal/MediaErrors';
import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import type {
  BeginConsumeResult,
  IUploadSessionStore,
  UploadSessionRecord,
} from '../../../media/domain/contracts/IUploadSessionStore';
import type { IMediaProcessor } from '../../../media/domain/contracts/IMediaProcessor';
import type { IMediaFileStore } from '../../../media/domain/contracts/IMediaFileStore';
import type { MediaCapabilities } from '../../../media/domain/contracts/MediaCapabilities';
import type { MediaProbe } from '../../../media/domain/services/parseProbeOutput';
import type { IOutboundMediaQueue } from '../contracts/IOutboundMediaQueue';

const TENANT = 'tenant-1';
const USER = 'user-1';
const CONVERSA = 'conv-1';
const SESSAO = 'sess-1';
const UPLOAD = 'up-1';
const EXT = 'EXT-1';
const BIN = '/uploads/up-1.bin';
const OGG = '/uploads/up-1.voice.ogg';
const NOW = new Date('2026-09-25T12:00:00.000Z');

const LIMITS = { imageBytes: 16_000, inlineVideoBytes: 180_000, documentBytes: 200_000, voiceBytes: 50_000 };

const ascii = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0));
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
const MP4 = Uint8Array.from([0, 0, 0, 0x18, ...ascii('ftypisom')]);
const WEBM = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]);
const PDF = ascii('%PDF-1.7');

function sonda(over: Partial<MediaProbe> = {}): MediaProbe {
  return {
    durationSeconds: 12, width: 1280, height: 720, videoCodec: 'h264',
    pixelFormat: 'yuv420p', audioCodec: 'aac', hasAudio: true, ...over,
  };
}

function registro(over: Partial<UploadSessionRecord> = {}): UploadSessionRecord {
  return {
    uploadId: UPLOAD, tenantId: TENANT, userId: USER, purpose: 'media',
    fileName: 'foto.jpg', declaredMimeType: 'image/jpeg', sizeBytes: 1_000,
    chunkSizeBytes: 8_388_608, totalParts: 1, receivedParts: [0], state: 'CONSUMING',
    externalMessageId: null, messageId: null,
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    ...over,
  };
}

function mensagem(over: Record<string, unknown> = {}) {
  return {
    id: 'msg-nova', tenantId: TENANT, conversationId: CONVERSA,
    direction: ChatMessageDirection.OUTBOUND, type: ChatMessageType.IMAGE, content: null,
    mediaUrl: '/api/storage/media/sess-1_EXT-1.jpg', mimeType: 'image/jpeg', fileName: null,
    durationSeconds: null, externalMessageId: EXT, status: ChatMessageStatus.PENDING,
    isDeleted: false, quotedMessageId: null, sentAt: NOW,
    fromParticipant: null, fromParticipantName: null, createdAt: NOW,
    ...over,
  };
}

function citada(over: Record<string, unknown> = {}) {
  return mensagem({
    id: 'msg-citada', direction: ChatMessageDirection.INBOUND, type: ChatMessageType.TEXT,
    content: 'pergunta', mediaUrl: null, mimeType: null, externalMessageId: 'EXT-CITADA',
    status: ChatMessageStatus.SENT, ...over,
  });
}

function makeDeps(o: {
  conversation?: Record<string, unknown> | null;
  record?: Partial<UploadSessionRecord>;
  begin?: BeginConsumeResult;
  head?: Uint8Array | null;
  probe?: (path: string, demuxer: string) => Promise<MediaProbe>;
  caps?: Partial<MediaCapabilities>;
  engine?: IMessagingEngine | null;
  quoted?: Record<string, unknown> | null;
  stored?: Record<string, unknown> | null;
  createError?: Error;
  promoteError?: Error;
  enqueued?: boolean;
} = {}) {
  const calls: string[] = [];
  const track = <A extends unknown[], R>(name: string, impl: (...args: A) => R) =>
    vi.fn((...args: A) => {
      calls.push(name);
      return impl(...args);
    });

  const conversation = o.conversation === null ? null : {
    id: CONVERSA, tenantId: TENANT, sessionId: SESSAO,
    isGroup: false, groupJid: null, contactId: 'contact-1',
    ...o.conversation,
  };
  const record = registro(o.record);
  const begin: BeginConsumeResult = o.begin ?? { outcome: 'started', record };

  const messageRepo = {
    findById: vi.fn(async (id: string) => {
      if (id === 'msg-citada') return o.quoted === undefined ? citada() : o.quoted;
      if (id === 'msg-antiga') return o.stored === undefined ? mensagem({ id: 'msg-antiga' }) : o.stored;
      return null;
    }),
    create: track('create', async (data: Record<string, unknown>) => {
      if (o.createError) throw o.createError;
      return mensagem({ ...data, id: 'msg-nova', sentAt: NOW, createdAt: NOW });
    }),
    transitionStatus: vi.fn(async (_id: string, _t: string, _from: ChatMessageStatus[], to: ChatMessageStatus) => {
      const saved = await vi.mocked(messageRepo.create).mock.results[0].value;
      return { ...saved, status: to };
    }),
  };
  const conversationRepo = {
    findById: vi.fn().mockResolvedValue(conversation),
    updateLastMessage: track(
      'updateLastMessage',
      async (_id: string, _tenantId: string, _data: { lastMessagePreview: string; lastMessageAt: Date }) => undefined,
    ),
  };
  const contactRepo = {
    findById: vi.fn().mockResolvedValue({ id: 'contact-1', phone: '5511999999999' }),
  };
  const engine = o.engine === undefined
    ? ({ createOutboundMessageId: track('createOutboundMessageId', () => EXT) } as unknown as IMessagingEngine)
    : o.engine;

  const uploads = {
    beginConsume: track('beginConsume', async () => begin),
    setExternalId: track('setExternalId', async () => ({ ...record, externalMessageId: EXT })),
    releaseConsume: track('releaseConsume', async () => ({ ...record, state: 'OPEN' })),
    finishConsume: track('finishConsume', async () => ({ ...record, state: 'CONSUMED' })),
    discard: track('discard', async () => undefined),
    dropBinary: track('dropBinary', async () => undefined),
    readHead: track('readHead', async () => (o.head === undefined ? JPEG : o.head)),
    binPath: vi.fn(() => BIN),
  };
  const caps: MediaCapabilities = { transcodeVoice: true, probe: true, ...o.caps };
  const processor = {
    capabilities: vi.fn(() => caps),
    probe: track('probe', o.probe ?? (async () => sonda())),
    transcodeVoiceNote: track('transcodeVoiceNote', async () => undefined),
  };
  const files = {
    promote: track('promote', async (input: { mimeType: string }) => {
      if (o.promoteError) throw o.promoteError;
      const ext = input.mimeType.startsWith('audio/ogg') ? 'ogg' : 'bin';
      return { publicUrl: `/api/storage/media/sess-1_EXT-1.${ext}`, localPath: `/media/sess-1_EXT-1.${ext}`, sizeBytes: 1_000 };
    }),
    remove: track('remove', async () => undefined),
  };
  const queue = {
    enqueue: track('enqueue', () => o.enqueued ?? true),
    inFlightIds: vi.fn(() => []),
    drain: vi.fn(async () => undefined),
  };
  const tmpPathFor = vi.fn((uploadId: string, ext: string) => `/uploads/${uploadId}.voice.${ext}`);

  const useCase = new SendMediaMessageUseCase({
    messageRepo: messageRepo as unknown as IChatMessageRepository,
    conversationRepo: conversationRepo as unknown as IChatConversationRepository,
    contactRepo: contactRepo as unknown as IChatContactRepository,
    engine,
    uploads: uploads as unknown as IUploadSessionStore,
    processor: processor as unknown as IMediaProcessor,
    files: files as unknown as IMediaFileStore,
    queue: queue as unknown as IOutboundMediaQueue,
    limits: LIMITS,
    tmpPathFor,
  });
  return { useCase, calls, messageRepo, conversationRepo, uploads, processor, files, queue, engine };
}

type Deps = ReturnType<typeof makeDeps>;

const enviar = (d: Deps, over: { caption?: string | null; quotedMessageId?: string | null } = {}) =>
  d.useCase.execute({ tenantId: TENANT, userId: USER, conversationId: CONVERSA, uploadId: UPLOAD, ...over });

const gravado = (d: Deps) => d.messageRepo.create.mock.calls[0][0];

describe('SendMediaMessageUseCase — caminho feliz', () => {
  it('imagem: grava PENDING com o id pré-gerado, promove o arquivo e enfileira', async () => {
    const d = makeDeps();
    const out = await enviar(d, { caption: 'olha isso' });

    expect(d.uploads.setExternalId).toHaveBeenCalledWith(UPLOAD, EXT);
    expect(d.files.promote).toHaveBeenCalledWith({
      srcPath: BIN, sessionId: SESSAO, externalMessageId: EXT, mimeType: 'image/jpeg',
    });
    expect(gravado(d)).toEqual({
      tenantId: TENANT, conversationId: CONVERSA, direction: ChatMessageDirection.OUTBOUND,
      type: ChatMessageType.IMAGE, content: 'olha isso', mediaUrl: '/api/storage/media/sess-1_EXT-1.bin',
      mimeType: 'image/jpeg', fileName: null, durationSeconds: null, quotedMessageId: null,
      externalMessageId: EXT, status: ChatMessageStatus.PENDING,
    });
    expect(d.uploads.finishConsume).toHaveBeenCalledWith(UPLOAD, 'msg-nova');
    expect(d.queue.enqueue).toHaveBeenCalledWith({
      messageId: 'msg-nova', tenantId: TENANT, sessionId: SESSAO, conversationId: CONVERSA,
    });
    expect(out.replayed).toBe(false);
    expect(out.message).toMatchObject({
      id: 'msg-nova', type: ChatMessageType.IMAGE, status: ChatMessageStatus.PENDING,
      mediaUrl: '/api/storage/media/sess-1_EXT-1.bin', content: 'olha isso',
      quotedMessage: null, reactions: [], reactionsRevision: null, fromParticipantAvatarUrl: null,
      createdAt: NOW.toISOString(), sentAt: NOW.toISOString(),
    });
    expect(d.uploads.releaseConsume).not.toHaveBeenCalled();
  });

  it('segue a ordem: sessão antes do sniff, promoção antes de gravar, gravar antes de enfileirar', async () => {
    const d = makeDeps();
    await enviar(d);

    // Sem `dropBinary`: fora da voz, a promoção já levou o próprio `.bin`
    expect(d.calls).toEqual([
      'beginConsume', 'createOutboundMessageId', 'setExternalId', 'readHead',
      'promote', 'create', 'finishConsume', 'updateLastMessage', 'enqueue',
    ]);
  });

  it('documento: guarda o nome sanitizado do upload e o tipo do conteúdo', async () => {
    const d = makeDeps({
      record: { purpose: 'document', fileName: 'contrato.pdf', declaredMimeType: 'application/octet-stream' },
      head: PDF,
    });
    const out = await enviar(d);

    expect(d.processor.probe).not.toHaveBeenCalled();
    expect(gravado(d)).toMatchObject({
      type: ChatMessageType.DOCUMENT, mimeType: 'application/pdf', fileName: 'contrato.pdf', content: null,
    });
    expect(out.message.type).toBe(ChatMessageType.DOCUMENT);
  });

  it('documento não passa pelo probe, mesmo quando o conteúdo é vídeo', async () => {
    const d = makeDeps({
      record: { purpose: 'document', fileName: 'clipe.mp4', declaredMimeType: 'video/mp4' },
      head: MP4,
      probe: async () => { throw new MediaProcessingFailedError(); },
    });
    await enviar(d);

    expect(d.processor.probe).not.toHaveBeenCalled();
    expect(gravado(d)).toMatchObject({ type: ChatMessageType.DOCUMENT, mimeType: 'video/mp4', fileName: 'clipe.mp4' });
    expect(d.uploads.releaseConsume).not.toHaveBeenCalled();
  });

  it('vídeo H.264 yuv420p dentro do limite vai como vídeo com a duração do probe', async () => {
    const d = makeDeps({ record: { fileName: 'clipe.mp4', declaredMimeType: 'video/mp4' }, head: MP4 });
    await enviar(d);

    expect(d.processor.probe).toHaveBeenCalledWith(BIN, 'mov');
    expect(gravado(d)).toMatchObject({
      type: ChatMessageType.VIDEO, mimeType: 'video/mp4', durationSeconds: 12, fileName: null,
    });
  });
});

describe('SendMediaMessageUseCase — vídeo fora do padrão vira documento', () => {
  it('HEVC vai como documento, sem duração e com o nome do arquivo', async () => {
    const d = makeDeps({
      record: { fileName: 'clipe.mp4', declaredMimeType: 'video/mp4' },
      head: MP4,
      probe: async () => sonda({ videoCodec: 'hevc' }),
    });
    await enviar(d);

    expect(gravado(d)).toMatchObject({
      type: ChatMessageType.DOCUMENT, mimeType: 'video/mp4', fileName: 'clipe.mp4', durationSeconds: null,
    });
  });

  it('acima do limite inline vai como documento', async () => {
    const d = makeDeps({ record: { fileName: 'longo.mp4', sizeBytes: 190_000 }, head: MP4 });
    await enviar(d);

    expect(gravado(d).type).toBe(ChatMessageType.DOCUMENT);
  });

  it('arquivo que o ffprobe não consegue ler vai como documento, sem devolver o upload', async () => {
    const d = makeDeps({
      record: { fileName: 'clipe.mp4', declaredMimeType: 'video/mp4' },
      head: MP4,
      probe: async () => { throw new MediaProcessingFailedError(); },
    });
    await enviar(d);

    expect(d.processor.probe).toHaveBeenCalledWith(BIN, 'mov');
    expect(gravado(d)).toMatchObject({
      type: ChatMessageType.DOCUMENT, mimeType: 'video/mp4', fileName: 'clipe.mp4', durationSeconds: null,
    });
    expect(d.uploads.releaseConsume).not.toHaveBeenCalled();
  });

  it('erro inesperado no probe não vira documento: devolve o upload e propaga', async () => {
    const d = makeDeps({
      record: { fileName: 'clipe.mp4' },
      head: MP4,
      probe: async () => { throw new Error('EMFILE'); },
    });

    await expect(enviar(d)).rejects.toThrow('EMFILE');
    expect(d.uploads.releaseConsume).toHaveBeenCalledWith(UPLOAD);
    expect(d.messageRepo.create).not.toHaveBeenCalled();
  });

  it('sem ffprobe o codec é desconhecido: documento, sem chamar o probe', async () => {
    const d = makeDeps({ record: { fileName: 'clipe.mp4' }, head: MP4, caps: { probe: false } });
    await enviar(d);

    expect(d.processor.probe).not.toHaveBeenCalled();
    expect(gravado(d).type).toBe(ChatMessageType.DOCUMENT);
  });
});

describe('SendMediaMessageUseCase — nota de voz', () => {
  it('transcodifica para Ogg/Opus, lê a duração da saída e grava como áudio', async () => {
    const d = makeDeps({
      record: { purpose: 'voice', fileName: 'gravacao.webm', declaredMimeType: 'audio/webm' },
      head: WEBM,
      probe: async (path) => (path === OGG ? sonda({ durationSeconds: 7, videoCodec: null }) : sonda({ durationSeconds: null })),
    });
    const out = await enviar(d);

    expect(d.processor.probe).toHaveBeenNthCalledWith(1, BIN, 'matroska');
    expect(d.processor.transcodeVoiceNote).toHaveBeenCalledWith(BIN, 'matroska', OGG);
    expect(d.processor.probe).toHaveBeenNthCalledWith(2, OGG, 'ogg');
    expect(d.files.promote).toHaveBeenCalledWith({
      srcPath: OGG, sessionId: SESSAO, externalMessageId: EXT, mimeType: 'audio/ogg; codecs=opus',
    });
    expect(gravado(d)).toMatchObject({
      type: ChatMessageType.AUDIO, mimeType: 'audio/ogg; codecs=opus', durationSeconds: 7, fileName: null,
    });
    expect(out.message.durationSeconds).toBe(7);
  });

  it('depois de virar mensagem, apaga o original do upload (o arquivo promovido é o transcodificado)', async () => {
    const d = makeDeps({ record: { purpose: 'voice' }, head: WEBM });
    await enviar(d);

    expect(d.uploads.dropBinary).toHaveBeenCalledWith(UPLOAD);
    expect(d.calls.indexOf('dropBinary')).toBe(d.calls.indexOf('finishConsume') + 1);
  });

  it('falha ao apagar o original da voz não impede o envio', async () => {
    const d = makeDeps({ record: { purpose: 'voice' }, head: WEBM });
    d.uploads.dropBinary.mockRejectedValueOnce(new Error('EBUSY'));
    const out = await enviar(d);

    expect(d.queue.enqueue).toHaveBeenCalled();
    expect(out.message.status).toBe(ChatMessageStatus.PENDING);
  });

  it('ignora a legenda: grava sem texto e a prévia da conversa usa o rótulo do áudio', async () => {
    const d = makeDeps({ record: { purpose: 'voice' }, head: WEBM });
    const out = await enviar(d, { caption: 'escuta isso' });

    expect(gravado(d).content).toBeNull();
    expect(out.message.content).toBeNull();
    expect(d.conversationRepo.updateLastMessage.mock.calls[0][2].lastMessagePreview).toBe('🎵 Áudio');
  });

  it('gravação que o ffprobe não lê é recusada e o upload volta a OPEN', async () => {
    const d = makeDeps({
      record: { purpose: 'voice' },
      head: WEBM,
      probe: async () => { throw new MediaProcessingFailedError(); },
    });

    await expect(enviar(d)).rejects.toBeInstanceOf(MediaProcessingFailedError);
    expect(d.processor.transcodeVoiceNote).not.toHaveBeenCalled();
    expect(d.uploads.releaseConsume).toHaveBeenCalledWith(UPLOAD);
    expect(d.messageRepo.create).not.toHaveBeenCalled();
  });

  it('sem ffmpeg recusa com MEDIA_PROCESSOR_UNAVAILABLE e devolve o upload', async () => {
    const d = makeDeps({ record: { purpose: 'voice' }, head: WEBM, caps: { transcodeVoice: false } });

    await expect(enviar(d)).rejects.toBeInstanceOf(MediaProcessorUnavailableError);
    expect(d.processor.probe).not.toHaveBeenCalled();
    expect(d.processor.transcodeVoiceNote).not.toHaveBeenCalled();
    expect(d.uploads.releaseConsume).toHaveBeenCalledWith(UPLOAD);
    expect(d.messageRepo.create).not.toHaveBeenCalled();
  });

  it('falha do ffmpeg apaga a saída parcial e devolve o upload', async () => {
    const d = makeDeps({ record: { purpose: 'voice' }, head: WEBM });
    d.processor.transcodeVoiceNote.mockRejectedValueOnce(new MediaProcessingFailedError());

    await expect(enviar(d)).rejects.toBeInstanceOf(MediaProcessingFailedError);
    expect(d.files.remove).toHaveBeenCalledWith(OGG);
    expect(d.uploads.releaseConsume).toHaveBeenCalledWith(UPLOAD);
    expect(d.files.promote).not.toHaveBeenCalled();
  });
});

describe('SendMediaMessageUseCase — confirmação repetida e estados do upload', () => {
  it('upload já consumido devolve a mesma mensagem, sem gravar, enfileirar nem gerar id', async () => {
    const d = makeDeps({
      begin: { outcome: 'consumed', messageId: 'msg-antiga', record: registro({ state: 'CONSUMED', messageId: 'msg-antiga' }) },
      stored: mensagem({ id: 'msg-antiga', quotedMessageId: 'msg-citada' }),
    });
    const out = await enviar(d);

    expect(out.replayed).toBe(true);
    expect(out.message.id).toBe('msg-antiga');
    expect(out.message.quotedMessage?.id).toBe('msg-citada');
    expect(d.calls).toEqual(['beginConsume']);
  });

  it('upload consumido em outra conversa não é devolvido nesta', async () => {
    const d = makeDeps({
      begin: { outcome: 'consumed', messageId: 'msg-antiga', record: registro({ state: 'CONSUMED' }) },
      stored: mensagem({ id: 'msg-antiga', conversationId: 'conv-outra' }),
    });

    await expect(enviar(d)).rejects.toBeInstanceOf(UploadNotFoundError);
  });

  it.each([
    ['in_progress', UploadInProgressError],
    ['incomplete', UploadIncompleteError],
    ['not_found', UploadNotFoundError],
  ] as const)('upload %s recusa sem tocar em nada', async (outcome, erro) => {
    const begin = (outcome === 'not_found' ? { outcome } : { outcome, record: registro() }) as BeginConsumeResult;
    const d = makeDeps({ begin });

    await expect(enviar(d)).rejects.toBeInstanceOf(erro);
    expect(d.calls).toEqual(['beginConsume']);
  });

  it('conversa de outro tenant: NotFoundError antes de reservar o upload', async () => {
    const d = makeDeps({ conversation: null });

    await expect(enviar(d)).rejects.toBeInstanceOf(NotFoundError);
    expect(d.uploads.beginConsume).not.toHaveBeenCalled();
  });
});

describe('SendMediaMessageUseCase — recusas antes de gravar', () => {
  it('sessão desconectada: erro antes de gravar e o upload volta a OPEN', async () => {
    const engine = {
      createOutboundMessageId: vi.fn(() => { throw new SessionNotConnectedError(SESSAO); }),
    } as unknown as IMessagingEngine;
    const d = makeDeps({ engine });

    await expect(enviar(d)).rejects.toBeInstanceOf(SessionNotConnectedError);
    expect(d.calls).toEqual(['beginConsume', 'releaseConsume']);
  });

  it.each([
    ['sem engine', { engine: null }],
    ['conversa sem sessão', { conversation: { sessionId: null } }],
  ] as const)('%s: SessionNotConnectedError e upload devolvido', async (_caso, over) => {
    const d = makeDeps(over);

    await expect(enviar(d)).rejects.toBeInstanceOf(SessionNotConnectedError);
    expect(d.calls).toEqual(['beginConsume', 'releaseConsume']);
  });

  it('classificação rejeitada devolve o upload e nada é gravado', async () => {
    const d = makeDeps({ record: { purpose: 'document', sizeBytes: 250_000 }, head: PDF });

    await expect(enviar(d)).rejects.toBeInstanceOf(MediaTooLargeError);
    expect(d.uploads.releaseConsume).toHaveBeenCalledWith(UPLOAD);
    expect(d.files.promote).not.toHaveBeenCalled();
    expect(d.messageRepo.create).not.toHaveBeenCalled();
  });

  it('arquivo do upload sumiu: UPLOAD_NOT_FOUND e upload devolvido', async () => {
    const d = makeDeps({ head: null });

    await expect(enviar(d)).rejects.toBeInstanceOf(UploadNotFoundError);
    expect(d.uploads.releaseConsume).toHaveBeenCalledWith(UPLOAD);
  });

  it('falha na promoção devolve o upload antes de propagar', async () => {
    const d = makeDeps({ promoteError: new Error('disco cheio') });

    await expect(enviar(d)).rejects.toThrow('disco cheio');
    expect(d.uploads.releaseConsume).toHaveBeenCalledWith(UPLOAD);
    expect(d.messageRepo.create).not.toHaveBeenCalled();
  });
});

describe('SendMediaMessageUseCase — depois de promover', () => {
  it('falha ao gravar apaga o arquivo promovido e descarta o upload', async () => {
    const d = makeDeps({ createError: new Error('banco fora') });

    await expect(enviar(d)).rejects.toThrow('banco fora');
    expect(d.files.remove).toHaveBeenCalledWith('/media/sess-1_EXT-1.bin');
    expect(d.uploads.discard).toHaveBeenCalledWith(UPLOAD);
    expect(d.uploads.releaseConsume).not.toHaveBeenCalled();
    expect(d.queue.enqueue).not.toHaveBeenCalled();
  });

  it('fila recusa: mensagem vira FAILED e a resposta leva esse status', async () => {
    const d = makeDeps({ enqueued: false });
    const out = await enviar(d);

    expect(d.messageRepo.transitionStatus).toHaveBeenCalledWith(
      'msg-nova', TENANT, [ChatMessageStatus.PENDING], ChatMessageStatus.FAILED,
    );
    expect(out.message.status).toBe(ChatMessageStatus.FAILED);
  });

  it('falha na prévia da conversa não impede o envio', async () => {
    const d = makeDeps();
    d.conversationRepo.updateLastMessage.mockRejectedValueOnce(new Error('banco lento'));
    const out = await enviar(d);

    expect(d.queue.enqueue).toHaveBeenCalled();
    expect(out.message.status).toBe(ChatMessageStatus.PENDING);
  });
});

describe('SendMediaMessageUseCase — citação e prévia', () => {
  it('citada da mesma conversa é vinculada e resumida no DTO', async () => {
    const d = makeDeps();
    const out = await enviar(d, { quotedMessageId: 'msg-citada' });

    expect(gravado(d).quotedMessageId).toBe('msg-citada');
    expect(out.message.quotedMessage).toEqual({
      id: 'msg-citada', type: ChatMessageType.TEXT, content: 'pergunta', mediaUrl: null,
      direction: ChatMessageDirection.INBOUND, isDeleted: false,
    });
  });

  it('citada de outra conversa não é vinculada', async () => {
    const d = makeDeps({ quoted: citada({ conversationId: 'conv-outra' }) });
    const out = await enviar(d, { quotedMessageId: 'msg-citada' });

    expect(gravado(d).quotedMessageId).toBeNull();
    expect(out.message.quotedMessage).toBeNull();
  });

  it('prévia da conversa usa a legenda', async () => {
    const d = makeDeps();
    await enviar(d, { caption: 'segue a foto' });

    expect(d.conversationRepo.updateLastMessage).toHaveBeenCalledWith(CONVERSA, TENANT, {
      lastMessagePreview: 'segue a foto', lastMessageAt: NOW,
    });
  });

  it.each([
    ['imagem', {}, JPEG, '📷 Imagem'],
    ['documento', { purpose: 'document' as const }, PDF, '📄 Documento'],
  ])('sem legenda, a prévia da %s é o rótulo do tipo', async (_tipo, record, head, rotulo) => {
    const d = makeDeps({ record, head });
    await enviar(d, { caption: '' });

    expect(gravado(d).content).toBeNull();
    expect(d.conversationRepo.updateLastMessage.mock.calls[0][2].lastMessagePreview).toBe(rotulo);
  });
});
