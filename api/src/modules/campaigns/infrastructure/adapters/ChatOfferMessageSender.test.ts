import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  conv: null as Record<string, unknown> | null,
  engine: null as Record<string, unknown> | null,
  sendText: vi.fn(),
  sendStored: vi.fn(),
}));

vi.mock('../../../chat/infrastructure/chatMediaContainer', () => ({
  chatMediaContainer: {
    conversationRepo: { findById: async () => h.conv },
    messageRepo: {},
    contactRepo: {},
    sendStoredMediaMessage: () => ({ execute: h.sendStored }),
  },
}));
vi.mock('../../../../shared/engine/activeEngine', () => ({ getActiveEngine: () => h.engine }));
vi.mock('../../../chat/application/use-cases/SendMessageUseCase', () => ({
  SendMessageUseCase: class {
    execute = h.sendText;
  },
}));

import { ChatOfferMessageSender } from './ChatOfferMessageSender';

const base = { tenantId: 't1', conversationId: 'c1', text: 'oferta', imageUrl: null, mentionAll: true };
const group = { id: 'c1', sessionId: 's1', isGroup: true, groupJid: '1203@g.us' };

beforeEach(() => {
  h.conv = { ...group };
  h.engine = {
    getGroupParticipants: vi.fn().mockResolvedValue([
      { phone: '5511999990001', name: null, avatarUrl: null, isAdmin: false },
      { phone: null, name: 'LID', avatarUrl: null, isAdmin: false },
      { phone: '5511999990001', name: null, avatarUrl: null, isAdmin: true },
      { phone: '5511999990002', name: null, avatarUrl: null, isAdmin: false },
    ]),
  };
  h.sendText.mockReset().mockResolvedValue({ id: 'm1', externalMessageId: 'X', status: 'SENT' });
  h.sendStored.mockReset().mockResolvedValue({ message: { id: 'm2', status: 'PENDING' } });
});

describe('ChatOfferMessageSender — marcar todos', () => {
  it('grupo + mentionAll: texto sai com os telefones dos participantes (sem repetidos)', async () => {
    await new ChatOfferMessageSender().send(base);
    expect(h.engine!.getGroupParticipants).toHaveBeenCalledWith('s1', '1203@g.us');
    expect(h.sendText).toHaveBeenCalledWith(expect.objectContaining({ mentions: ['5511999990001', '5511999990002'] }));
  });

  it('sem mentionAll ou conversa individual: sem consulta e sem menção', async () => {
    await new ChatOfferMessageSender().send({ ...base, mentionAll: false });
    h.conv = { ...group, isGroup: false, groupJid: null };
    await new ChatOfferMessageSender().send(base);
    expect(h.engine!.getGroupParticipants).not.toHaveBeenCalled();
    expect(h.sendText.mock.calls.map((c) => c[0].mentions)).toEqual([null, null]);
  });

  it('falha ao listar participantes: envia sem menção', async () => {
    (h.engine!.getGroupParticipants as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'));
    await expect(new ChatOfferMessageSender().send(base)).resolves.toEqual({ chatMessageId: 'm1' });
    expect(h.sendText).toHaveBeenCalledWith(expect.objectContaining({ mentions: null }));
  });

  it('com foto + mentionAll em grupo: mídia sai com os mesmos telefones do texto', async () => {
    await new ChatOfferMessageSender().send({ ...base, imageUrl: 'store://offers/1.jpg' });
    expect(h.engine!.getGroupParticipants).toHaveBeenCalledWith('s1', '1203@g.us');
    expect(h.sendStored).toHaveBeenCalledWith(expect.objectContaining({
      caption: 'oferta', mentions: ['5511999990001', '5511999990002'],
    }));
    expect(h.sendText).not.toHaveBeenCalled();
  });

  it('com foto sem mentionAll: mídia sem menção e sem consulta', async () => {
    await new ChatOfferMessageSender().send({ ...base, mentionAll: false, imageUrl: 'store://offers/1.jpg' });
    expect(h.engine!.getGroupParticipants).not.toHaveBeenCalled();
    expect(h.sendStored).toHaveBeenCalledWith(expect.objectContaining({ mentions: null }));
  });
});
