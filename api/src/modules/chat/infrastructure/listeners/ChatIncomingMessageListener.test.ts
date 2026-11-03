import { describe, expect, it, vi } from 'vitest';

const { publish } = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock('../ws/ChatWebSocketPublisher', () => ({ chatWsPublisher: { publish } }));

import { registerChatIncomingMessageListener } from './ChatIncomingMessageListener';
import { internalEventBus } from '../../../../shared/events/InternalEventBus';
import type { IngestIncomingMessageUseCase } from '../../application/use-cases/IngestIncomingMessageUseCase';

describe('ChatIncomingMessageListener — prévia de link', () => {
  it('repassa linkPreview ao ingest e publica a prévia da entidade no WS', async () => {
    const lp = { url: 'https://loja.com/p', title: 'Produto', description: null, thumbnailUrl: '/media/x_lp.jpg' };
    const execute = vi.fn(async () => ({
      conversationId: 'c1',
      isNewConversation: false,
      unreadCount: 1,
      message: { id: 'm1', tenantId: 't1', conversationId: 'c1', linkPreview: lp, sentAt: new Date(), createdAt: new Date() },
    }));
    registerChatIncomingMessageListener({ execute } as unknown as IngestIncomingMessageUseCase);

    internalEventBus.emit('MESSAGE_RECEIVED', {
      type: 'MESSAGE_RECEIVED', sessionId: 's1', tenantId: 't1', from: '5511', body: 'x', linkPreview: lp,
    });

    await vi.waitFor(() => expect(publish).toHaveBeenCalled());
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ linkPreview: lp }));
    expect(publish.mock.calls[0][1].data.message.linkPreview).toEqual(lp);
    internalEventBus.removeAllListeners('MESSAGE_RECEIVED');
  });
});
