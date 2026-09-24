import { describe, it, expect, vi } from 'vitest';
import { IngestHistorySyncUseCase, type HistoryMessageItem } from './IngestHistorySyncUseCase';
import { ChatMessageType } from '../../domain/enums/ChatMessageEnums';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';

const TENANT = 'tenant-1';
const SESSION = 'sess-1';

function makeDeps(options?: { conversaExistente?: boolean }) {
  const existente = options?.conversaExistente ?? false;

  const conversationRepo = {
    findActiveByContactAndSession: vi.fn().mockResolvedValue(existente ? { id: 'conv-1' } : null),
    findActiveByGroupAndSession: vi.fn().mockResolvedValue(existente ? { id: 'conv-g' } : null),
    create: vi.fn().mockResolvedValue({ id: 'conv-nova' }),
    updateLastMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as IChatConversationRepository;

  const contactRepo = {
    findOrCreate: vi.fn().mockResolvedValue({ id: 'contact-1' }),
  } as unknown as IChatContactRepository;

  const messageRepo = {
    findByExternalId: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'msg-1' }),
  } as unknown as IChatMessageRepository;

  return { conversationRepo, contactRepo, messageRepo };
}

function makeItem(overrides: Partial<HistoryMessageItem> = {}): HistoryMessageItem {
  return {
    externalMessageId: 'ext-1',
    from: '5511999999999',
    body: 'oi',
    msgType: ChatMessageType.TEXT,
    fromMe: false,
    timestamp: new Date('2026-09-24T12:00:00.000Z'),
    ...overrides,
  };
}

/** O processamento roda em background via setImmediate. */
async function aguardarProcessamento(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

describe('IngestHistorySyncUseCase', () => {
  it('semeia o contador do aparelho ao criar a conversa', async () => {
    // Sem isso, conversa importada nasce como lida: a reconciliação posterior é
    // monotônica para baixo e nunca a corrigiria para cima.
    const deps = makeDeps();
    const useCase = new IngestHistorySyncUseCase(deps.contactRepo, deps.conversationRepo, deps.messageRepo);

    useCase.execute({
      tenantId: TENANT,
      sessionId: SESSION,
      messages: [makeItem()],
      unreadByChat: { '5511999999999': 7 },
    });
    await aguardarProcessamento();

    expect(deps.conversationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ unreadCount: 7 }),
    );
  });

  it('semeia o contador também em conversa de grupo', async () => {
    const deps = makeDeps();
    const useCase = new IngestHistorySyncUseCase(deps.contactRepo, deps.conversationRepo, deps.messageRepo);

    useCase.execute({
      tenantId: TENANT,
      sessionId: SESSION,
      messages: [makeItem({ isGroup: true, groupJid: '123456', groupName: 'Equipe' })],
      unreadByChat: { '123456': 3 },
    });
    await aguardarProcessamento();

    expect(deps.conversationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ isGroup: true, unreadCount: 3 }),
    );
  });

  it('cria sem contador quando o lote não informa', async () => {
    const deps = makeDeps();
    const useCase = new IngestHistorySyncUseCase(deps.contactRepo, deps.conversationRepo, deps.messageRepo);

    useCase.execute({ tenantId: TENANT, sessionId: SESSION, messages: [makeItem()] });
    await aguardarProcessamento();

    const args = (deps.conversationRepo.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(args).not.toHaveProperty('unreadCount');
  });

  it('não mexe no contador de conversa que já existe', async () => {
    // Conversa existente é reconciliada pelo espelhamento, que sabe comparar com o
    // estado atual; sobrescrever aqui ignoraria leituras já feitas no painel.
    const deps = makeDeps({ conversaExistente: true });
    const useCase = new IngestHistorySyncUseCase(deps.contactRepo, deps.conversationRepo, deps.messageRepo);

    useCase.execute({
      tenantId: TENANT,
      sessionId: SESSION,
      messages: [makeItem()],
      unreadByChat: { '5511999999999': 9 },
    });
    await aguardarProcessamento();

    expect(deps.conversationRepo.create).not.toHaveBeenCalled();
  });

  it('ignora lote sem mensagem aproveitável', async () => {
    const deps = makeDeps();
    const useCase = new IngestHistorySyncUseCase(deps.contactRepo, deps.conversationRepo, deps.messageRepo);

    useCase.execute({
      tenantId: TENANT,
      sessionId: SESSION,
      messages: [makeItem({ externalMessageId: '', body: null, msgType: undefined })],
    });
    await aguardarProcessamento();

    expect(deps.messageRepo.create).not.toHaveBeenCalled();
  });
});
