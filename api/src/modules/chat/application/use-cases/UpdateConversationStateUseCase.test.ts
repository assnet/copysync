import { describe, it, expect, vi } from 'vitest';
import { UpdateConversationStateUseCase } from './UpdateConversationStateUseCase';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type { IChatListRepository } from '../../domain/contracts/IChatListRepository';

const TENANT = 'tenant-1';
const CONVERSA = 'conv-1';

function makeDeps() {
  const conversation = {
    id: CONVERSA, tenantId: TENANT, sessionId: null, isGroup: false, contactId: 'contact-1',
    groupJid: null, unreadCount: 0, archived: false, pinned: false, mutedUntil: null,
    favorite: false, manuallyUnread: false, tags: [] as string[],
  };
  const conversationRepo = {
    findById: vi.fn().mockResolvedValue(conversation),
    updateState: vi.fn().mockImplementation(async (_id: string, _t: string, data: { tags?: string[] }) => ({
      ...conversation, tags: data.tags ?? conversation.tags,
    })),
  } as unknown as IChatConversationRepository;
  const contactRepo = { findById: vi.fn() } as unknown as IChatContactRepository;
  const messageRepo = { findMany: vi.fn().mockResolvedValue([]) } as unknown as IChatMessageRepository;
  const listRepo = { ensure: vi.fn().mockResolvedValue({ id: 'list-1' }) } as unknown as IChatListRepository;
  return { conversationRepo, contactRepo, messageRepo, listRepo };
}

describe('UpdateConversationStateUseCase', () => {
  it('cada lista informada ganha entrada no catálogo antes de gravar a conversa', async () => {
    const d = makeDeps();
    const useCase = new UpdateConversationStateUseCase(d.conversationRepo, d.contactRepo, d.messageRepo, d.listRepo);

    const result = await useCase.execute({ tenantId: TENANT, conversationId: CONVERSA, lists: ['VIP', ' Leads ', '  '] });

    expect(d.listRepo.ensure).toHaveBeenCalledTimes(2);
    expect(d.listRepo.ensure).toHaveBeenCalledWith(TENANT, 'VIP');
    expect(d.listRepo.ensure).toHaveBeenCalledWith(TENANT, 'Leads');
    const ensureOrder = (d.listRepo.ensure as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const updateOrder = (d.conversationRepo.updateState as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(ensureOrder).toBeLessThan(updateOrder);
    expect(result.lists).toEqual(['VIP', ' Leads ', '  ']);
    expect(result.syncedToWhatsApp).toBe(false);
  });

  it('mudança sem listas não toca o catálogo', async () => {
    const d = makeDeps();
    const useCase = new UpdateConversationStateUseCase(d.conversationRepo, d.contactRepo, d.messageRepo, d.listRepo);

    await useCase.execute({ tenantId: TENANT, conversationId: CONVERSA, favorite: true });

    expect(d.listRepo.ensure).not.toHaveBeenCalled();
    expect(d.conversationRepo.updateState).toHaveBeenCalledWith(CONVERSA, TENANT, expect.objectContaining({ favorite: true }));
  });
});
