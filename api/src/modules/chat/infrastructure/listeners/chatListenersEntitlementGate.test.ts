import { afterEach, describe, expect, it, vi } from 'vitest';

const { publish } = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock('../ws/ChatWebSocketPublisher', () => ({ chatWsPublisher: { publish } }));

import { internalEventBus } from '../../../../shared/events/InternalEventBus';
import { logger } from '../../../../shared/logger/logger';
import { registerChatContactAvatarListener } from './ChatContactAvatarListener';
import { registerChatGroupAvatarListener } from './ChatGroupAvatarListener';
import { registerChatMessageReactionListener } from './ChatMessageReactionListener';
import { registerChatConversationStateListener } from './ChatConversationStateListener';
import { registerChatPresenceListener } from './ChatPresenceListener';
import { registerChatMessageStatusListener } from './ChatMessageStatusListener';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type { IngestMessageReactionUseCase } from '../../application/use-cases/IngestMessageReactionUseCase';

const EVENTS = ['CONTACT_AVATAR_UPDATED', 'GROUP_AVATAR_UPDATED', 'MESSAGE_REACTION_UPDATED', 'CHAT_STATE_UPDATED', 'PRESENCE_UPDATED', 'MESSAGE_DELIVERED', 'MESSAGE_READ'] as const;

function setup(enabled: boolean) {
  const gate = { isChatEnabled: vi.fn().mockResolvedValue(enabled) };
  const contactRepo = { updateAvatarUrlByPhone: vi.fn().mockResolvedValue(undefined) } as unknown as IChatContactRepository;
  const conversationRepo = {
    updateGroupAvatarUrlByGroupJid: vi.fn().mockResolvedValue(undefined),
    applyRemoteState: vi.fn().mockResolvedValue({ conversationId: 'c1', changed: { pinned: true } }),
  } as unknown as IChatConversationRepository;
  const messageRepo = { updateStatusByExternalId: vi.fn().mockResolvedValue({ id: 'm1', conversationId: 'c1', status: 'DELIVERED' }) } as unknown as IChatMessageRepository;
  const reaction = { execute: vi.fn().mockResolvedValue({ messageId: 'm1' }) };
  registerChatContactAvatarListener(contactRepo, gate);
  registerChatGroupAvatarListener(conversationRepo, gate);
  registerChatMessageReactionListener(reaction as unknown as IngestMessageReactionUseCase, gate);
  registerChatConversationStateListener(conversationRepo, gate);
  registerChatPresenceListener(gate);
  registerChatMessageStatusListener(messageRepo, gate);
  return { gate, contactRepo, conversationRepo, messageRepo, reaction };
}

function emitAll() {
  const t = { tenantId: 't1', sessionId: 's1' };
  const emit = internalEventBus.emit.bind(internalEventBus) as (type: string, payload: unknown) => boolean;
  emit('CONTACT_AVATAR_UPDATED', { type: 'CONTACT_AVATAR_UPDATED', ...t, phone: '5511', avatarUrl: '/a.jpg' });
  emit('GROUP_AVATAR_UPDATED', { type: 'GROUP_AVATAR_UPDATED', ...t, groupJid: 'g1', avatarUrl: '/g.jpg' });
  emit('MESSAGE_REACTION_UPDATED', { type: 'MESSAGE_REACTION_UPDATED', ...t, targetExternalMessageId: 'E1', emoji: 'x', reactorKey: 'k', reactedAt: new Date().toISOString() });
  emit('CHAT_STATE_UPDATED', { type: 'CHAT_STATE_UPDATED', ...t, isGroup: false, chatId: '5511', state: {} });
  emit('PRESENCE_UPDATED', { type: 'PRESENCE_UPDATED', ...t, phone: '5511', presence: 'composing' });
  emit('MESSAGE_DELIVERED', { type: 'MESSAGE_DELIVERED', ...t, messageId: 'E1' });
  emit('MESSAGE_READ', { type: 'MESSAGE_READ', ...t, messageId: 'E1' });
}

afterEach(() => {
  for (const e of EVENTS) internalEventBus.removeAllListeners(e);
  publish.mockReset();
});

describe('listeners do chat — gate por entitlement (entrega D)', () => {
  it('tenant sem chat: nenhum listener grava nem publica', async () => {
    const d = setup(false);
    emitAll();
    await vi.waitFor(() => expect(d.gate.isChatEnabled).toHaveBeenCalledTimes(7));
    await new Promise((r) => setImmediate(r));
    expect(d.contactRepo.updateAvatarUrlByPhone).not.toHaveBeenCalled();
    expect(d.conversationRepo.updateGroupAvatarUrlByGroupJid).not.toHaveBeenCalled();
    expect(d.conversationRepo.applyRemoteState).not.toHaveBeenCalled();
    expect(d.messageRepo.updateStatusByExternalId).not.toHaveBeenCalled();
    expect(d.reaction.execute).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('tenant com chat: todos seguem o caminho atual', async () => {
    const d = setup(true);
    emitAll();
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(7));
    expect(d.contactRepo.updateAvatarUrlByPhone).toHaveBeenCalledTimes(1);
    expect(d.conversationRepo.updateGroupAvatarUrlByGroupJid).toHaveBeenCalledTimes(1);
    expect(d.conversationRepo.applyRemoteState).toHaveBeenCalledTimes(1);
    expect(d.messageRepo.updateStatusByExternalId).toHaveBeenCalledTimes(2);
    expect(d.reaction.execute).toHaveBeenCalledTimes(1);
  });

  it('sem gate (flag desligada): presença publica na hora, sem consulta', () => {
    registerChatPresenceListener();
    (internalEventBus.emit.bind(internalEventBus) as (t: string, p: unknown) => boolean)(
      'PRESENCE_UPDATED', { type: 'PRESENCE_UPDATED', tenantId: 't1', sessionId: 's1', phone: '5511', presence: 'available' },
    );
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('presença: publish que lança não vira rejeição (loga e segue)', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never);
    const rejections: unknown[] = [];
    const onRejection = (r: unknown) => { rejections.push(r); };
    process.on('unhandledRejection', onRejection);
    publish.mockImplementationOnce(() => { throw new Error('ws down'); });
    registerChatPresenceListener({ isChatEnabled: vi.fn().mockResolvedValue(true) });
    (internalEventBus.emit.bind(internalEventBus) as (t: string, p: unknown) => boolean)(
      'PRESENCE_UPDATED', { type: 'PRESENCE_UPDATED', tenantId: 't1', sessionId: 's1', phone: '5511', presence: 'available' },
    );
    await new Promise((r) => setTimeout(r, 10));
    process.off('unhandledRejection', onRejection);
    expect(rejections).toHaveLength(0);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }), expect.any(String));
    error.mockRestore();
  });
});
