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

import { ChatOfferMessageSender, TELEGRAM_CAPTION_MAX } from './ChatOfferMessageSender';
import { MediaNotFoundError } from '../../../../shared/errors/internal/MediaErrors';
import { MEDIA_IMAGE_MODE_ENABLED } from '../../domain/enums/OfferImageMode';

const base = {
  tenantId: 't1', conversationId: 'c1', text: 'oferta', imageUrl: null as string | null, mentionAll: true,
  imageMode: 'MEDIA' as const, title: null, affiliateUrl: 'https://amzn.to/x',
  simulateTyping: false, typingSeconds: 15, scheduledAt: null,
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

describe('ChatOfferMessageSender — formato da imagem', () => {
  const img = { imageJpeg: Buffer.from('big'), thumbnailJpeg: Buffer.from('thumb') };
  const build = vi.fn();
  const files = {} as never;
  const sender = () => new ChatOfferMessageSender(undefined, { previewImage: () => ({ build }), files: () => files });
  const lp = {
    ...base, mentionAll: false, imageMode: 'LINK_PREVIEW' as const, title: '  Fone X  ',
    text: 'Fone X por R$ 10\n🛒https://amzn.to/x', imageUrl: 'https://cdn/media/offer-1.jpg',
  };
  beforeEach(() => { build.mockReset().mockResolvedValue(img); });

  it('MEDIA com foto: mídia armazenada, sem prévia', async () => {
    await sender().send({ ...base, mentionAll: false, imageUrl: 'https://cdn/media/offer-1.jpg' });
    expect(h.sendStored).toHaveBeenCalledOnce();
    expect(build).not.toHaveBeenCalled();
    expect(h.sendText).not.toHaveBeenCalled();
  });

  it('LINK_PREVIEW completo: texto com prévia, sem mídia armazenada', async () => {
    await expect(sender().send(lp)).resolves.toEqual({ chatMessageId: 'm1' });
    expect(build).toHaveBeenCalledWith('t1', 'https://cdn/media/offer-1.jpg');
    expect(h.sendStored).not.toHaveBeenCalled();
    expect(h.sendText).toHaveBeenCalledWith(expect.objectContaining({
      content: lp.text,
      linkPreview: { url: 'https://amzn.to/x', title: 'Fone X', description: null, thumbnailJpeg: img.thumbnailJpeg, imageJpeg: img.imageJpeg },
    }));
  });

  it.each([
    ['sem título', { title: '   ' }],
    ['sem link', { text: 'Fone X sem link' }],
    ['só com link que não é o da oferta', { text: 'Fone X\n🛒https://meli.la/outro' }],
    ['sem foto', { imageUrl: null }],
  ])('LINK_PREVIEW %s: texto puro', async (_n, over) => {
    await sender().send({ ...lp, ...over });
    expect(h.sendStored).not.toHaveBeenCalled();
    expect(h.sendText).toHaveBeenCalledOnce();
    expect(h.sendText.mock.calls[0][0]).not.toHaveProperty('linkPreview');
  });

  it('LINK_PREVIEW com imagem indisponível: texto puro', async () => {
    build.mockResolvedValue(null);
    await sender().send(lp);
    expect(h.sendStored).not.toHaveBeenCalled();
    expect(h.sendText.mock.calls[0][0]).not.toHaveProperty('linkPreview');
  });
});

describe('ChatOfferMessageSender — marca d\'água e Telegram (IMG-15)', () => {
  const img = { imageJpeg: Buffer.from('big'), thumbnailJpeg: Buffer.from('thumb') };
  const build = vi.fn();
  const applies = vi.fn();
  const decorate = vi.fn(async (_t: string, b: Buffer) => Buffer.concat([b, Buffer.from('+marca')]));
  const files = {} as never;
  const sender = (withDecorator = true) => new ChatOfferMessageSender(undefined, {
    previewImage: () => ({ build }), files: () => files,
    ...(withDecorator ? { decorator: () => ({ applies, decorate }) } : {}),
  });
  const lp = {
    ...base, mentionAll: false, imageMode: 'LINK_PREVIEW' as const, title: 'Fone X',
    text: 'Fone X por R$ 10\n🛒https://amzn.to/x', imageUrl: 'https://cdn/media/offer-1.jpg' as string | null,
  };
  const telegram = { ...group, channel: 'telegram' };
  const whatsapp = { ...group, channel: 'whatsapp' };

  beforeEach(() => {
    build.mockReset().mockResolvedValue(img);
    applies.mockReset().mockResolvedValue(true);
    decorate.mockClear();
  });

  /** O que o envio de hoje faz em LINK_PREVIEW (sem decorador nenhum). */
  async function todayCalls(conv: Record<string, unknown>, input: typeof lp) {
    h.conv = { ...conv };
    await sender(false).send(input);
    const calls = { text: h.sendText.mock.calls, stored: h.sendStored.mock.calls, build: build.mock.calls };
    h.sendText.mockClear(); h.sendStored.mockClear(); build.mockClear();
    return JSON.stringify(calls);
  }

  it('MEDIA_IMAGE_MODE_ENABLED segue false', () => {
    expect(MEDIA_IMAGE_MODE_ENABLED).toBe(false);
  });

  it('Telegram + marca aplicável: foto marcada com o texto na legenda, ignorando LINK_PREVIEW', async () => {
    h.conv = { ...telegram };
    await expect(sender().send(lp)).resolves.toEqual({ chatMessageId: 'm2' });
    expect(applies).toHaveBeenCalledWith('t1');
    expect(h.sendText).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
    const call = h.sendStored.mock.calls[0]![0];
    expect(call).toMatchObject({ tenantId: 't1', conversationId: 'c1', sourceMediaUrl: lp.imageUrl, caption: lp.text, mentions: null });
    // A função passada ao chat é a decoração do tenant
    await expect(call.decorate(Buffer.from('foto'))).resolves.toEqual(Buffer.from('foto+marca'));
    expect(decorate).toHaveBeenCalledWith('t1', Buffer.from('foto'));
  });

  it('Telegram com texto no limite (1024 caracteres, emoji conta 1) ainda vai como legenda', async () => {
    h.conv = { ...telegram };
    await sender().send({ ...lp, text: '🛒'.repeat(TELEGRAM_CAPTION_MAX) });
    expect(h.sendStored).toHaveBeenCalledOnce();
  });

  it('Telegram com texto acima de 1024: envio atual (mesmas chamadas de hoje)', async () => {
    const long = { ...lp, text: `${'a'.repeat(TELEGRAM_CAPTION_MAX)}\n🛒https://amzn.to/x` };
    const ref = await todayCalls(telegram, long);
    h.conv = { ...telegram };
    await sender().send(long);
    expect(h.sendStored).not.toHaveBeenCalled();
    expect(JSON.stringify({ text: h.sendText.mock.calls, stored: h.sendStored.mock.calls, build: build.mock.calls })).toBe(ref);
  });

  it('Telegram sem marca: chamadas idênticas às de hoje', async () => {
    applies.mockResolvedValue(false);
    const ref = await todayCalls(telegram, lp);
    h.conv = { ...telegram };
    await sender().send(lp);
    expect(JSON.stringify({ text: h.sendText.mock.calls, stored: h.sendStored.mock.calls, build: build.mock.calls })).toBe(ref);
    expect(decorate).not.toHaveBeenCalled();
  });

  it('WhatsApp com marca aplicável: chamadas idênticas às de hoje (marca entra na prévia), sem consultar o ramo', async () => {
    const ref = await todayCalls(whatsapp, lp);
    h.conv = { ...whatsapp };
    await sender().send(lp);
    expect(JSON.stringify({ text: h.sendText.mock.calls, stored: h.sendStored.mock.calls, build: build.mock.calls })).toBe(ref);
    expect(applies).not.toHaveBeenCalled();
  });

  it('Telegram + marca, oferta sem foto: texto como hoje', async () => {
    const noPhoto = { ...lp, imageUrl: null };
    const ref = await todayCalls(telegram, noPhoto);
    h.conv = { ...telegram };
    await sender().send(noPhoto);
    expect(h.sendStored).not.toHaveBeenCalled();
    expect(JSON.stringify({ text: h.sendText.mock.calls, stored: h.sendStored.mock.calls, build: build.mock.calls })).toBe(ref);
  });

  it('Telegram + marca, foto sumida do storage: cai no envio atual sem falhar', async () => {
    h.conv = { ...telegram };
    h.sendStored.mockRejectedValueOnce(new MediaNotFoundError());
    build.mockResolvedValue(null); // a prévia também não acha a foto
    await expect(sender().send(lp)).resolves.toEqual({ chatMessageId: 'm1' });
    expect(h.sendText).toHaveBeenCalledOnce();
    expect(h.sendText.mock.calls[0][0]).toMatchObject({ content: lp.text });
    expect(h.sendText.mock.calls[0][0]).not.toHaveProperty('linkPreview');
  });

  it('Telegram + marca, outro erro no envio da mídia: propaga', async () => {
    h.conv = { ...telegram };
    h.sendStored.mockRejectedValueOnce(new Error('db'));
    await expect(sender().send(lp)).rejects.toThrow('db');
    expect(h.sendText).not.toHaveBeenCalled();
  });

  it('MEDIA sem marca aplicável: sem decoração (igual a hoje)', async () => {
    applies.mockResolvedValue(false);
    h.conv = { ...whatsapp };
    await sender().send({ ...lp, imageMode: 'MEDIA' });
    expect(h.sendStored.mock.calls[0]![0]).not.toHaveProperty('decorate');
  });

  it('MEDIA com marca aplicável (se religado): mídia decorada (IMG-08)', async () => {
    h.conv = { ...whatsapp };
    await sender().send({ ...lp, imageMode: 'MEDIA' });
    expect(typeof h.sendStored.mock.calls[0]![0].decorate).toBe('function');
  });
});
