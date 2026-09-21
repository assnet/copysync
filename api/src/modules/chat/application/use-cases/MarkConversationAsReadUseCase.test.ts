import { describe, it, expect, vi } from 'vitest';
import { MarkConversationAsReadUseCase } from './MarkConversationAsReadUseCase';
import { ChatMessageDirection } from '../../domain/enums/ChatMessageEnums';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';

const TENANT = 'tenant-1';
const CONVERSA = 'conv-1';

function makeDeps(overrides?: {
  conversation?: Record<string, unknown> | null;
  messages?: Array<Record<string, unknown>>;
}) {
  const conversation = overrides?.conversation === undefined
    ? { id: CONVERSA, tenantId: TENANT, sessionId: 'sess-1', isGroup: false, contactId: 'contact-1', groupJid: null }
    : overrides.conversation;

  const conversationRepo = {
    findById: vi.fn().mockResolvedValue(conversation),
    resetUnread: vi.fn().mockResolvedValue(undefined),
  } as unknown as IChatConversationRepository;

  const contactRepo = {
    findById: vi.fn().mockResolvedValue({ id: 'contact-1', phone: '5511999999999' }),
  } as unknown as IChatContactRepository;

  const messageRepo = {
    findMany: vi.fn().mockResolvedValue(
      overrides?.messages ?? [
        { direction: ChatMessageDirection.OUTBOUND, externalMessageId: 'out-2' },
        { direction: ChatMessageDirection.INBOUND, externalMessageId: 'in-9' },
        { direction: ChatMessageDirection.INBOUND, externalMessageId: 'in-8' },
      ],
    ),
  } as unknown as IChatMessageRepository;

  const engine = {
    markMessagesRead: vi.fn().mockResolvedValue(undefined),
  } as unknown as IMessagingEngine;

  return { conversationRepo, contactRepo, messageRepo, engine };
}

describe('MarkConversationAsReadUseCase', () => {
  it('zera o contador de não lidas da conversa', async () => {
    const deps = makeDeps();
    const useCase = new MarkConversationAsReadUseCase(
      deps.conversationRepo, deps.contactRepo, deps.messageRepo, deps.engine,
    );

    await useCase.execute({ conversationId: CONVERSA, tenantId: TENANT });

    expect(deps.conversationRepo.resetUnread).toHaveBeenCalledWith(CONVERSA, TENANT);
  });

  it('envia um único recibo, o da mensagem recebida mais recente', async () => {
    // O WhatsApp marca as anteriores como lidas a partir dela; mandar um recibo por
    // mensagem multiplicaria o tráfego de saída sem necessidade.
    const deps = makeDeps();
    const useCase = new MarkConversationAsReadUseCase(
      deps.conversationRepo, deps.contactRepo, deps.messageRepo, deps.engine,
    );

    await useCase.execute({ conversationId: CONVERSA, tenantId: TENANT });

    expect(deps.engine.markMessagesRead).toHaveBeenCalledTimes(1);
    expect(deps.engine.markMessagesRead).toHaveBeenCalledWith(
      expect.objectContaining({ messageIds: ['in-9'] }),
    );
  });

  it('zera o contador mesmo sem sessão conectada', async () => {
    const deps = makeDeps();
    const useCase = new MarkConversationAsReadUseCase(
      deps.conversationRepo, deps.contactRepo, deps.messageRepo, null,
    );

    await useCase.execute({ conversationId: CONVERSA, tenantId: TENANT });

    expect(deps.conversationRepo.resetUnread).toHaveBeenCalledWith(CONVERSA, TENANT);
  });

  it('não envia recibo quando não há mensagem recebida na conversa', async () => {
    const deps = makeDeps({
      messages: [{ direction: ChatMessageDirection.OUTBOUND, externalMessageId: 'out-1' }],
    });
    const useCase = new MarkConversationAsReadUseCase(
      deps.conversationRepo, deps.contactRepo, deps.messageRepo, deps.engine,
    );

    await useCase.execute({ conversationId: CONVERSA, tenantId: TENANT });

    expect(deps.engine.markMessagesRead).not.toHaveBeenCalled();
  });

  it('falha de recibo não desfaz a leitura local', async () => {
    const deps = makeDeps();
    (deps.engine.markMessagesRead as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'));
    const useCase = new MarkConversationAsReadUseCase(
      deps.conversationRepo, deps.contactRepo, deps.messageRepo, deps.engine,
    );

    await expect(useCase.execute({ conversationId: CONVERSA, tenantId: TENANT })).resolves.toBeUndefined();
    expect(deps.conversationRepo.resetUnread).toHaveBeenCalled();
  });

  it('rejeita conversa inexistente', async () => {
    const deps = makeDeps({ conversation: null });
    const useCase = new MarkConversationAsReadUseCase(
      deps.conversationRepo, deps.contactRepo, deps.messageRepo, deps.engine,
    );

    await expect(useCase.execute({ conversationId: CONVERSA, tenantId: TENANT })).rejects.toThrow();
  });
});
