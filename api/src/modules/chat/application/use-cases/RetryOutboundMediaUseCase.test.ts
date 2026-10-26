import { describe, it, expect, vi } from 'vitest';
import { RetryOutboundMediaUseCase } from './RetryOutboundMediaUseCase';
import { ChatMessage, type ChatMessageProps } from '../../domain/entities/ChatMessage';
import {
  ChatMessageDirection,
  ChatMessageStatus,
  ChatMessageType,
} from '../../domain/enums/ChatMessageEnums';
import {
  ConflictError,
  NotFoundError,
  TooManyRequestsError,
} from '../../../../shared/errors/internal/ResourceErrors';
import { SessionNotConnectedError } from '../../../../shared/errors/internal/SessionErrors';
import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import type { IMediaFileStore } from '../../../media/domain/contracts/IMediaFileStore';
import type { IOutboundMediaQueue } from '../contracts/IOutboundMediaQueue';

const TENANT = 'tenant-1';
const CRIADA = new Date('2026-09-25T12:00:00.000Z');

function mensagem(over: Partial<ChatMessageProps> = {}): ChatMessageProps {
  return {
    id: 'msg-1', tenantId: TENANT, conversationId: 'conv-1',
    direction: ChatMessageDirection.OUTBOUND, type: ChatMessageType.VIDEO,
    content: 'legenda', mediaUrl: '/media/sess-1/ext-1.mp4', mimeType: 'video/mp4',
    fileName: null, durationSeconds: 12, externalMessageId: 'ext-1',
    status: ChatMessageStatus.FAILED, isDeleted: false, quotedMessageId: null,
    sentAt: null, fromParticipant: null, fromParticipantName: null, createdAt: CRIADA,
    ...over,
  };
}

function makeDeps(overrides?: {
  message?: Partial<ChatMessageProps> | null;
  conversation?: Record<string, unknown> | null;
  engine?: IMessagingEngine | null;
  /** `false` = `acquireLocalFile` devolve `null` (arquivo apagado ou URL fora do store). */
  fileAvailable?: boolean;
  enqueue?: boolean;
}) {
  const props = overrides?.message === null ? null : mensagem(overrides?.message);
  // Estado do banco: a leitura devolve a foto do momento; a transição é atômica (como o
  // `updateMany` condicional do repositório), então só um retry concorrente vence.
  const db = { status: props?.status ?? null };

  const messageRepo = {
    findById: vi.fn().mockResolvedValue(props ? new ChatMessage(props) : null),
    transitionStatus: vi.fn(async (
      _id: string, _tenantId: string, from: ChatMessageStatus[], to: ChatMessageStatus,
    ) => {
      if (!props || !db.status || !from.includes(db.status)) return null;
      db.status = to;
      return new ChatMessage({ ...props, status: to });
    }),
  } as unknown as IChatMessageRepository;

  const conversation = overrides?.conversation === null
    ? null
    : { id: 'conv-1', tenantId: TENANT, sessionId: 'sess-1', ...overrides?.conversation };
  const conversationRepo = {
    findById: vi.fn().mockResolvedValue(conversation),
  } as unknown as IChatConversationRepository;

  const release = vi.fn().mockResolvedValue(undefined);
  const fileStore = {
    acquireLocalFile: vi.fn().mockResolvedValue(
      overrides?.fileAvailable === false
        ? null
        : { filePath: '/data/media/sess-1/ext-1.mp4', sizeBytes: 1_000, release },
    ),
  } as unknown as IMediaFileStore;

  const engine = overrides?.engine === undefined
    ? ({ createOutboundMessageId: vi.fn().mockReturnValue('id-novo-descartado') } as unknown as IMessagingEngine)
    : overrides.engine;

  const queue = {
    enqueue: vi.fn().mockReturnValue(overrides?.enqueue ?? true),
  } as unknown as IOutboundMediaQueue;

  const useCase = new RetryOutboundMediaUseCase(messageRepo, conversationRepo, fileStore, engine, queue);
  return { useCase, messageRepo, conversationRepo, fileStore, release, engine, queue, db };
}

const run = (d: ReturnType<typeof makeDeps>) => d.useCase.execute({ tenantId: TENANT, messageId: 'msg-1' });

function expectNadaMudou(d: ReturnType<typeof makeDeps>) {
  expect(d.messageRepo.transitionStatus).not.toHaveBeenCalled();
  expect(d.queue.enqueue).not.toHaveBeenCalled();
}

describe('RetryOutboundMediaUseCase', () => {
  it('mensagem inexistente ou de outro tenant: NotFound, busca filtrada pelo tenant', async () => {
    const d = makeDeps({ message: null });
    await expect(run(d)).rejects.toBeInstanceOf(NotFoundError);
    expect(d.messageRepo.findById).toHaveBeenCalledWith('msg-1', TENANT);
    expectNadaMudou(d);
  });

  it.each<[string, Parameters<typeof makeDeps>[0]]>([
    ['mensagem recebida', { message: { direction: ChatMessageDirection.INBOUND } }],
    ['mensagem já enviada', { message: { status: ChatMessageStatus.SENT } }],
    ['mensagem ainda em envio', { message: { status: ChatMessageStatus.PENDING } }],
    ['mensagem de texto', { message: { type: ChatMessageType.TEXT, mediaUrl: null } }],
    ['figurinha', { message: { type: ChatMessageType.STICKER } }],
    ['mídia sem arquivo gravado', { message: { mediaUrl: null } }],
    ['mídia sem id do WhatsApp', { message: { externalMessageId: null } }],
    ['arquivo indisponível no store (apagado ou URL alheia)', { fileAvailable: false }],
  ])('%s: Conflict e nada muda', async (_caso, overrides) => {
    const d = makeDeps(overrides);
    await expect(run(d)).rejects.toBeInstanceOf(ConflictError);
    expectNadaMudou(d);
    expect(d.db.status).toBe(overrides?.message?.status ?? ChatMessageStatus.FAILED);
  });

  it('confere o arquivo pela mediaUrl gravada e o libera antes de seguir', async () => {
    const d = makeDeps();
    await run(d);
    expect(d.fileStore.acquireLocalFile).toHaveBeenCalledWith('/media/sess-1/ext-1.mp4');
    expect(d.release).toHaveBeenCalledTimes(1);
    const ordem = (fn: unknown) => vi.mocked(fn as () => void).mock.invocationCallOrder[0];
    expect(ordem(d.release)).toBeLessThan(ordem(d.conversationRepo.findById));
  });

  it.each<[string, Parameters<typeof makeDeps>[0]]>([
    ['conversa não encontrada', { conversation: null }],
    ['engine indisponível', { engine: null }],
    ['fila recusa', { enqueue: false }],
  ])('%s: o arquivo obtido já foi liberado', async (_caso, overrides) => {
    const d = makeDeps(overrides);
    await expect(run(d)).rejects.toBeDefined();
    expect(d.release).toHaveBeenCalledTimes(1);
  });

  it('arquivo indisponível: nada a liberar', async () => {
    const d = makeDeps({ fileAvailable: false });
    await expect(run(d)).rejects.toBeInstanceOf(ConflictError);
    expect(d.release).not.toHaveBeenCalled();
  });

  it('conversa não encontrada no tenant: NotFound', async () => {
    const d = makeDeps({ conversation: null });
    await expect(run(d)).rejects.toBeInstanceOf(NotFoundError);
    expect(d.conversationRepo.findById).toHaveBeenCalledWith('conv-1', TENANT);
    expectNadaMudou(d);
  });

  it('sessão desconectada: erro de sessão e a mensagem continua FAILED', async () => {
    const engine = {
      createOutboundMessageId: vi.fn(() => { throw new SessionNotConnectedError('sess-1'); }),
    } as unknown as IMessagingEngine;
    const d = makeDeps({ engine });

    await expect(run(d)).rejects.toBeInstanceOf(SessionNotConnectedError);
    expect(engine.createOutboundMessageId).toHaveBeenCalledWith('sess-1');
    expectNadaMudou(d);
    expect(d.db.status).toBe(ChatMessageStatus.FAILED);
  });

  it.each<[string, Parameters<typeof makeDeps>[0]]>([
    ['conversa sem sessão', { conversation: { sessionId: null } }],
    ['engine indisponível', { engine: null }],
  ])('%s: erro de sessão sem mudar status', async (_caso, overrides) => {
    const d = makeDeps(overrides);
    await expect(run(d)).rejects.toBeInstanceOf(SessionNotConnectedError);
    expectNadaMudou(d);
  });

  it('sucesso: FAILED → PENDING e enfileira reusando o id já gravado, sem gerar outro', async () => {
    const d = makeDeps();
    const out = await run(d);

    expect(d.messageRepo.transitionStatus).toHaveBeenCalledTimes(1);
    expect(d.messageRepo.transitionStatus).toHaveBeenCalledWith(
      'msg-1', TENANT, [ChatMessageStatus.FAILED], ChatMessageStatus.PENDING,
    );
    expect(d.queue.enqueue).toHaveBeenCalledWith({
      messageId: 'msg-1', tenantId: TENANT, sessionId: 'sess-1', conversationId: 'conv-1',
    });
    // Status só muda depois da checagem de sessão, e o job só entra depois da transição.
    const ordem = (fn: unknown) => vi.mocked(fn as () => void).mock.invocationCallOrder[0];
    expect(ordem(d.engine!.createOutboundMessageId)).toBeLessThan(ordem(d.messageRepo.transitionStatus));
    expect(ordem(d.messageRepo.transitionStatus)).toBeLessThan(ordem(d.queue.enqueue));

    expect(d.db.status).toBe(ChatMessageStatus.PENDING);
    expect(out).toMatchObject({
      id: 'msg-1', conversationId: 'conv-1', tenantId: TENANT,
      direction: ChatMessageDirection.OUTBOUND, type: ChatMessageType.VIDEO,
      mediaUrl: '/media/sess-1/ext-1.mp4', mimeType: 'video/mp4', durationSeconds: 12,
      externalMessageId: 'ext-1', status: ChatMessageStatus.PENDING,
      createdAt: CRIADA.toISOString(), sentAt: null,
      fromParticipantAvatarUrl: null, reactionsRevision: null, reactions: [],
    });
    expect(JSON.stringify(out)).not.toContain('id-novo-descartado');
  });

  it('fila recusa: volta a FAILED e responde 429', async () => {
    const d = makeDeps({ enqueue: false });

    await expect(run(d)).rejects.toBeInstanceOf(TooManyRequestsError);
    expect(d.messageRepo.transitionStatus).toHaveBeenNthCalledWith(
      2, 'msg-1', TENANT, [ChatMessageStatus.PENDING], ChatMessageStatus.FAILED,
    );
    expect(d.db.status).toBe(ChatMessageStatus.FAILED);
  });

  it('dois retries simultâneos: só um enfileira; o outro perde a transição e recebe Conflict', async () => {
    const d = makeDeps();

    const resultados = await Promise.allSettled([run(d), run(d)]);

    const ok = resultados.filter((r) => r.status === 'fulfilled');
    const falhas = resultados.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(falhas).toHaveLength(1);
    expect(falhas[0].reason).toBeInstanceOf(ConflictError);
    expect(d.messageRepo.transitionStatus).toHaveBeenCalledTimes(2);
    expect(d.queue.enqueue).toHaveBeenCalledTimes(1);
    expect(d.db.status).toBe(ChatMessageStatus.PENDING);
  });
});
