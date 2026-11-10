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

describe('IngestIncomingMessageUseCase — gate do chat (entrega D)', () => {
  function makeGated(enabled: boolean) {
    const contactRepo = { findOrCreate: vi.fn().mockResolvedValue({ id: 'ct1' }) } as unknown as IChatContactRepository;
    const conversationRepo = {
      findActiveByContactAndSession: vi.fn().mockResolvedValue({ id: 'c1', unreadCount: 0 }),
      findActiveByGroupAndSession: vi.fn().mockResolvedValue({ id: 'g1', unreadCount: 0 }),
      create: vi.fn(),
      updateLastMessage: vi.fn(),
      incrementUnread: vi.fn(),
      findById: vi.fn().mockResolvedValue({ unreadCount: 1 }),
    } as unknown as IChatConversationRepository;
    const messageRepo = { findByExternalId: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'm1' }) } as unknown as IChatMessageRepository;
    const gate = { isChatEnabled: vi.fn().mockResolvedValue(enabled) };
    const uc = new IngestIncomingMessageUseCase(contactRepo, conversationRepo, messageRepo, undefined, gate);
    return { uc, contactRepo, conversationRepo, messageRepo, gate };
  }

  it('desligado, 1:1: só upsert do contato, sem conversa nem mensagem, devolve null', async () => {
    const { uc, contactRepo, conversationRepo, messageRepo, gate } = makeGated(false);
    const r = await uc.execute({ ...base, fromName: 'Ana' });
    expect(r).toBeNull();
    expect(gate.isChatEnabled).toHaveBeenCalledWith('t1');
    expect(contactRepo.findOrCreate).toHaveBeenCalledWith({ tenantId: 't1', phone: '5511', name: 'Ana' });
    expect(conversationRepo.findActiveByContactAndSession).not.toHaveBeenCalled();
    expect(conversationRepo.updateLastMessage).not.toHaveBeenCalled();
    expect(conversationRepo.incrementUnread).not.toHaveBeenCalled();
    expect(messageRepo.findByExternalId).not.toHaveBeenCalled();
    expect(messageRepo.create).not.toHaveBeenCalled();
  });

  it('desligado, fromMe: contato com o telefone como nome (pushName é nosso)', async () => {
    const { uc, contactRepo } = makeGated(false);
    await uc.execute({ ...base, fromName: 'Eu', fromMe: true });
    expect(contactRepo.findOrCreate).toHaveBeenCalledWith({ tenantId: 't1', phone: '5511', name: '5511' });
  });

  it('desligado, grupo: nada gravado', async () => {
    const { uc, contactRepo, conversationRepo, messageRepo } = makeGated(false);
    const r = await uc.execute({ ...base, isGroup: true, groupJid: '1203', participant: '5599' });
    expect(r).toBeNull();
    expect(contactRepo.findOrCreate).not.toHaveBeenCalled();
    expect(conversationRepo.findActiveByGroupAndSession).not.toHaveBeenCalled();
    expect(messageRepo.create).not.toHaveBeenCalled();
  });

  it('ligado: ingestão completa como sem gate', async () => {
    const { uc, messageRepo, conversationRepo } = makeGated(true);
    const r = await uc.execute(base);
    expect(r).not.toBeNull();
    expect(messageRepo.create).toHaveBeenCalledTimes(1);
    expect(conversationRepo.incrementUnread).toHaveBeenCalledTimes(1);
  });
});

describe('IngestIncomingMessageUseCase — LID do contato (MQ-19)', () => {
  function makeLid(enabled: boolean | null) {
    const contactRepo = { findOrCreate: vi.fn().mockResolvedValue({ id: 'ct1' }) } as unknown as IChatContactRepository;
    const conversationRepo = {
      findActiveByContactAndSession: vi.fn().mockResolvedValue({ id: 'c1', unreadCount: 0 }),
      findActiveByGroupAndSession: vi.fn().mockResolvedValue({ id: 'g1', unreadCount: 0 }),
      updateLastMessage: vi.fn(),
      incrementUnread: vi.fn(),
      findById: vi.fn().mockResolvedValue({ unreadCount: 1 }),
    } as unknown as IChatConversationRepository;
    const messageRepo = { findByExternalId: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'm1' }) } as unknown as IChatMessageRepository;
    const gate = enabled === null ? undefined : { isChatEnabled: vi.fn().mockResolvedValue(enabled) };
    return { uc: new IngestIncomingMessageUseCase(contactRepo, conversationRepo, messageRepo, undefined, gate), contactRepo };
  }

  it('1:1 com chat: passa o LID ao contato', async () => {
    const { uc, contactRepo } = makeLid(null);
    await uc.execute({ ...base, fromName: 'Ana', authorLid: '777' });
    expect(contactRepo.findOrCreate).toHaveBeenCalledWith({ tenantId: 't1', phone: '5511', name: 'Ana', lid: '777' });
  });

  it('1:1 com chat desligado: o upsert do contato também leva o LID', async () => {
    const { uc, contactRepo } = makeLid(false);
    await uc.execute({ ...base, fromName: 'Ana', authorLid: '777' });
    expect(contactRepo.findOrCreate).toHaveBeenCalledWith({ tenantId: 't1', phone: '5511', name: 'Ana', lid: '777' });
  });

  it('grupo: LID do participante não grava contato', async () => {
    const { uc, contactRepo } = makeLid(true);
    await uc.execute({ ...base, isGroup: true, groupJid: '1203', participant: '5599', authorLid: '777' });
    expect(contactRepo.findOrCreate).not.toHaveBeenCalled();
  });
});
