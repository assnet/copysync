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

const base = {
  tenantId: 't1', conversationId: 'c1', text: 'oferta', imageUrl: null, mentionAll: true,
  simulateTyping: false, typingSeconds: 15,
};
const group = { id: 'c1', sessionId: 's1', isGroup: true, groupJid: '1203@g.us' };

beforeEach(() => {
  h.conv = { ...group };
  h.engine = {
    sendPresence: vi.fn().mockResolvedValue(undefined),
    getGroupParticipants: vi.fn().mockResolvedValue([
      { jid: '5511999990001@s.whatsapp.net', phone: '5511999990001', name: null, avatarUrl: null, isAdmin: false },
      { jid: '123456@lid', phone: null, name: 'LID', avatarUrl: null, isAdmin: false },
      { jid: '5511999990001@s.whatsapp.net', phone: '5511999990001', name: null, avatarUrl: null, isAdmin: true },
      { jid: '', phone: '5511999990002', name: null, avatarUrl: null, isAdmin: false },
    ]),
  };
  h.sendText.mockReset().mockResolvedValue({ id: 'm1', externalMessageId: 'X', status: 'SENT' });
  h.sendStored.mockReset().mockResolvedValue({ message: { id: 'm2', status: 'PENDING' } });
});

describe('ChatOfferMessageSender — marcar todos', () => {
  it('grupo + mentionAll: texto sai com os telefones dos participantes (sem repetidos)', async () => {
    await new ChatOfferMessageSender().send(base);
    expect(h.engine!.getGroupParticipants).toHaveBeenCalledWith('s1', '1203@g.us');
    expect(h.sendText).toHaveBeenCalledWith(expect.objectContaining({ mentions: ['5511999990001@s.whatsapp.net', '123456@lid'] }));
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
      caption: 'oferta', mentions: ['5511999990001@s.whatsapp.net', '123456@lid'],
    }));
    expect(h.sendText).not.toHaveBeenCalled();
  });

  it('com foto sem mentionAll: mídia sem menção e sem consulta', async () => {
    await new ChatOfferMessageSender().send({ ...base, mentionAll: false, imageUrl: 'store://offers/1.jpg' });
    expect(h.engine!.getGroupParticipants).not.toHaveBeenCalled();
    expect(h.sendStored).toHaveBeenCalledWith(expect.objectContaining({ mentions: null }));
  });
});

describe('ChatOfferMessageSender — digitando', () => {
  const sleep = vi.fn().mockResolvedValue(undefined);
  // groupJid como no banco (sem sufixo): o destino vira 1203@g.us
  beforeEach(() => { sleep.mockClear(); h.conv = { ...group, groupJid: '1203' }; });

  it('15 s: "composing" renovado a cada 8 s, total esperado = 15 s, "paused" antes de enviar', async () => {
    await new ChatOfferMessageSender(sleep).send({ ...base, mentionAll: false, simulateTyping: true });
    const presence = h.engine!.sendPresence as ReturnType<typeof vi.fn>;
    expect(presence.mock.calls).toEqual([
      ['s1', '1203@g.us', 'composing'],
      ['s1', '1203@g.us', 'composing'],
      ['s1', '1203@g.us', 'paused'],
    ]);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([8_000, 7_000]);
    expect(presence.mock.invocationCallOrder.at(-1)!).toBeLessThan(h.sendText.mock.invocationCallOrder[0]!);
  });

  it('desligado: sem presença e sem espera', async () => {
    await new ChatOfferMessageSender(sleep).send({ ...base, mentionAll: false });
    expect(h.engine!.sendPresence).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('falha na presença: envia mesmo assim, sem esperar', async () => {
    (h.engine!.sendPresence as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'));
    await expect(new ChatOfferMessageSender(sleep).send({ ...base, mentionAll: false, simulateTyping: true }))
      .resolves.toEqual({ chatMessageId: 'm1' });
    expect(sleep).not.toHaveBeenCalled();
  });
});
