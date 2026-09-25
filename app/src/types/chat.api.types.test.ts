import { describe, expect, it } from 'vitest';
import { apiMessageToFrontend, type ApiMessageStatus, type ChatMessageApiDto } from './chat.api.types';

function mensagemDaApi(status: ApiMessageStatus): ChatMessageApiDto {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    tenantId: 'tenant-1',
    direction: 'OUTBOUND',
    type: 'IMAGE',
    content: null,
    mediaUrl: null,
    mimeType: 'image/jpeg',
    fileName: null,
    durationSeconds: null,
    externalMessageId: null,
    status,
    isDeleted: false,
    quotedMessageId: null,
    sentAt: '2026-09-25T12:00:00Z',
    createdAt: '2026-09-25T12:00:00Z',
  };
}

describe('apiMessageToFrontend — status da mensagem', () => {
  it('mensagem pendente no servidor aparece como enviando no painel', () => {
    expect(apiMessageToFrontend(mensagemDaApi('PENDING')).status).toBe('sending');
  });

  it('status desconhecido (API mais nova) cai em enviada', () => {
    const desconhecido = 'QUALQUER_OUTRO' as unknown as ApiMessageStatus;
    expect(apiMessageToFrontend(mensagemDaApi(desconhecido)).status).toBe('sent');
  });

  it('mantém o mapeamento dos status já existentes', () => {
    expect(apiMessageToFrontend(mensagemDaApi('SENT')).status).toBe('sent');
    expect(apiMessageToFrontend(mensagemDaApi('DELIVERED')).status).toBe('delivered');
    expect(apiMessageToFrontend(mensagemDaApi('READ')).status).toBe('read');
    expect(apiMessageToFrontend(mensagemDaApi('FAILED')).status).toBe('failed');
  });
});
