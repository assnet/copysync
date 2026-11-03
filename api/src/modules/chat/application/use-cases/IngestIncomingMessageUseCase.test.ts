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
