import { describe, expect, it, vi } from 'vitest';
import { IngestIncomingMessageUseCase } from './IngestIncomingMessageUseCase';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';

function make() {
  const contactRepo = { findOrCreate: vi.fn().mockResolvedValue({ id: 'ct1' }) } as unknown as IChatContactRepository;
  const conversationRepo = {
    findActiveByContactAndSession: vi.fn().mockResolvedValue({ id: 'c1', unreadCount: 0 }),
    updateLastMessage: vi.fn(),
    incrementUnread: vi.fn(),
    findById: vi.fn().mockResolvedValue({ unreadCount: 1 }),
  } as unknown as IChatConversationRepository;
  const create = vi.fn().mockResolvedValue({ id: 'm1' });
  const messageRepo = { findByExternalId: vi.fn().mockResolvedValue(null), create } as unknown as IChatMessageRepository;
  return { uc: new IngestIncomingMessageUseCase(contactRepo, conversationRepo, messageRepo), create };
}

const base = { tenantId: 't1', sessionId: 's1', from: '5511', body: 'Olha https://loja.com/p', externalMessageId: 'E1' };

describe('IngestIncomingMessageUseCase — prévia de link', () => {
  it('grava a prévia com campos ausentes como null', async () => {
    const { uc, create } = make();
    await uc.execute({ ...base, linkPreview: { url: 'https://loja.com/p', title: 'Produto' } });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      linkPreview: { url: 'https://loja.com/p', title: 'Produto', description: null, thumbnailUrl: null },
    }));
  });

  it('sem prévia grava null', async () => {
    const { uc, create } = make();
    await uc.execute(base);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ linkPreview: null }));
  });
});

describe('IngestIncomingMessageUseCase — canal da conversa', () => {
  function makeNew(engine: string | null) {
    const contactRepo = { findOrCreate: vi.fn().mockResolvedValue({ id: 'ct1' }) } as unknown as IChatContactRepository;
    const createConv = vi.fn().mockResolvedValue({ id: 'c1', unreadCount: 0 });
    const conversationRepo = {
      findActiveByContactAndSession: vi.fn().mockResolvedValue(null),
      findActiveByGroupAndSession: vi.fn().mockResolvedValue(null),
      create: createConv,
      updateLastMessage: vi.fn(),
      incrementUnread: vi.fn(),
      findById: vi.fn().mockResolvedValue({ unreadCount: 1 }),
    } as unknown as IChatConversationRepository;
    const messageRepo = { findByExternalId: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'm1' }) } as unknown as IChatMessageRepository;
    const sessions = { findEngineById: vi.fn().mockResolvedValue(engine) };
    return { uc: new IngestIncomingMessageUseCase(contactRepo, conversationRepo, messageRepo, sessions), createConv, sessions, conversationRepo };
  }

  it('sessão Telegram cria conversa de grupo com canal telegram', async () => {
    const { uc, createConv } = makeNew('telegram');
    await uc.execute({ ...base, isGroup: true, groupJid: '-1001234567890', externalMessageId: '-1001234567890_42' });
    expect(createConv).toHaveBeenCalledWith(expect.objectContaining({ channel: 'telegram', groupJid: '-1001234567890' }));
  });

  it('sessão Baileys (ou engine desconhecida) cria conversa individual com canal whatsapp', async () => {
    for (const engine of ['baileys', null]) {
      const { uc, createConv } = makeNew(engine);
      await uc.execute(base);
      expect(createConv).toHaveBeenCalledWith(expect.objectContaining({ channel: 'whatsapp' }));
    }
  });

  it('conversa existente não consulta a engine', async () => {
    const { uc, sessions, conversationRepo } = makeNew('telegram');
    vi.mocked(conversationRepo.findActiveByContactAndSession).mockResolvedValue({ id: 'c1', unreadCount: 0 } as never);
    await uc.execute(base);
    expect(sessions.findEngineById).not.toHaveBeenCalled();
  });
});
