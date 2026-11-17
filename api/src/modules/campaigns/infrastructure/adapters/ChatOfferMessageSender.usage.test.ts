import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Envio automático de oferta não soma em `chat_send`: o adapter de verdade, com o `SendMessageUseCase` de
 * verdade (sem mock), repositórios e engine falsos e o mesmo contador do painel injetado.
 */
const h = vi.hoisted(() => {
  const now = new Date('2026-11-20T12:00:00Z');
  return {
    now,
    conv: { id: 'c1', tenantId: 't1', sessionId: 's1', isGroup: true, groupJid: '1203@g.us', contactId: null, channel: 'whatsapp' },
    engine: {
      sendTextMessage: vi.fn(async () => ({ messageId: 'EXT-1', sentAt: now })),
      sendPresence: vi.fn(async () => undefined),
      getGroupParticipants: vi.fn(async () => []),
    },
    create: vi.fn(),
  };
});

vi.mock('../../../chat/infrastructure/chatMediaContainer', () => ({
  chatMediaContainer: {
    conversationRepo: { findById: async () => h.conv, updateLastMessage: async () => undefined },
    messageRepo: { findById: async () => null, create: h.create },
    contactRepo: { findById: async () => null },
    sendStoredMediaMessage: () => ({ execute: vi.fn() }),
  },
}));
vi.mock('../../../../shared/engine/activeEngine', () => ({ getActiveEngine: () => h.engine }));

import { ChatOfferMessageSender } from './ChatOfferMessageSender';
import { SendMessageUseCase } from '../../../chat/application/use-cases/SendMessageUseCase';
import { chatMediaContainer } from '../../../chat/infrastructure/chatMediaContainer';

const offer = {
  tenantId: 't1', conversationId: 'c1', text: 'oferta https://amzn.to/x', imageUrl: null as string | null, mentionAll: false,
  imageMode: 'MEDIA' as const, title: null, affiliateUrl: 'https://amzn.to/x',
  simulateTyping: false, typingSeconds: 0, scheduledAt: null,
};

const recorder = { increment: vi.fn(async () => undefined), markOnce: vi.fn(async () => undefined) };

beforeEach(() => {
  recorder.increment.mockClear();
  h.engine.sendTextMessage.mockClear();
  h.create.mockReset().mockImplementation(async (data: Record<string, unknown>) => ({
    id: 'm1', tenantId: 't1', conversationId: 'c1', direction: data.direction, type: data.type, content: data.content,
    mediaUrl: null, mimeType: null, fileName: null, durationSeconds: null, externalMessageId: data.externalMessageId,
    status: 'SENT', isDeleted: false, quotedMessageId: null, sentAt: h.now, createdAt: h.now,
    fromParticipant: null, fromParticipantName: null, linkPreview: null,
  }));
});

describe('ChatOfferMessageSender — uso do chat', () => {
  it('oferta enviada pelo adapter sai pelo envio de texto real e não chama o contador', async () => {
    const out = await new ChatOfferMessageSender(undefined, { usage: () => recorder }).send(offer);
    expect(out).toEqual({ chatMessageId: 'm1' });
    expect(h.engine.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(recorder.increment).not.toHaveBeenCalled();
  });

  it('controle: o mesmo envio com origem PANEL e o mesmo contador soma 1', async () => {
    await new SendMessageUseCase(
      chatMediaContainer.messageRepo,
      chatMediaContainer.conversationRepo,
      chatMediaContainer.contactRepo,
      h.engine as never,
      null,
      recorder,
    ).execute({ tenantId: 't1', conversationId: 'c1', content: 'oi', origin: 'PANEL' });
    expect(recorder.increment).toHaveBeenCalledTimes(1);
  });
});
