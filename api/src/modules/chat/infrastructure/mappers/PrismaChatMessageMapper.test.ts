import type { ChatMessage as PrismaChatMessage } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { ChatMessageStatus } from '../../domain/enums/ChatMessageEnums';
import { PrismaChatMessageMapper } from './PrismaChatMessageMapper';

function row(overrides: Partial<PrismaChatMessage> = {}): PrismaChatMessage {
  return {
    id: 'm-1',
    tenantId: 't-1',
    conversationId: 'c-1',
    direction: 'OUTBOUND',
    type: 'IMAGE',
    content: 'legenda',
    mediaUrl: '/media/t-1/foto.jpg',
    mimeType: 'image/jpeg',
    fileName: null,
    durationSeconds: null,
    externalMessageId: null,
    status: 'SENT',
    isDeleted: false,
    quotedMessageId: null,
    sentAt: new Date('2026-09-25T10:00:00.000Z'),
    fromParticipant: null,
    fromParticipantName: null,
    createdAt: new Date('2026-09-25T10:00:01.000Z'),
    ...overrides,
  };
}

describe('PrismaChatMessageMapper', () => {
  it('mantém pendente a mídia gravada que ainda não chegou ao WhatsApp', () => {
    const message = PrismaChatMessageMapper.toDomain(row({ status: 'PENDING' }));

    expect(message.status).toBe(ChatMessageStatus.PENDING);
  });

  it('entrega como enviada a mensagem gravada como enviada', () => {
    const message = PrismaChatMessageMapper.toDomain(row({ status: 'SENT' }));

    expect(message.status).toBe(ChatMessageStatus.SENT);
  });

  it('mantém nulo o status de mensagem que nunca teve um, nunca inventa enviada', () => {
    const message = PrismaChatMessageMapper.toDomain(row({ status: null }));

    expect(message.status).toBeNull();
  });
});
