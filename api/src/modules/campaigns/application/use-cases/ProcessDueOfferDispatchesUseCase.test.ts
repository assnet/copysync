import { describe, it, expect, vi } from 'vitest';
import { OFFLINE_MAX_WAIT_MS, OFFLINE_RETRY_MS, ProcessDueOfferDispatchesUseCase } from './ProcessDueOfferDispatchesUseCase';
import { AppError } from '../../../../shared/errors/AppError';
import { InMemoryOfferDispatchRepository, InMemoryOfferRepository, makeOffer, NOW, TENANT } from './offerTestFakes';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { SessionNotConnectedError } from '../../../../shared/errors/internal/SessionErrors';
import { MediaNotFoundError } from '../../../../shared/errors/internal/MediaErrors';
import { OfferDestinationUnavailableError } from '../../../../shared/errors/internal/OfferErrors';

function setup(convs = ['c1', 'c2']) {
  const offers = new InMemoryOfferRepository();
  offers.items.push(makeOffer({ status: 'SENDING', text: 'oferta', imageUrl: 'store://1.jpg' }));
  const dispatches = new InMemoryOfferDispatchRepository(offers);
  for (const conversationId of convs) dispatches.add({ offerId: 'offer-1', conversationId });
  const sender = { send: vi.fn().mockResolvedValue({ chatMessageId: 'm1' }) };
  const uc = new ProcessDueOfferDispatchesUseCase({ offers, dispatches, sender, now: () => NOW, sendTimeoutMs: 50 });
  return { offers, dispatches, sender, uc };
}

const statuses = (s: ReturnType<typeof setup>) => s.dispatches.items.map((d) => [d.status, d.failureReason ?? d.chatMessageId]);

describe('ProcessDueOfferDispatchesUseCase', () => {
  it('oferta com mentionAll repassa a flag ao sender', async () => {
    const s = setup(['c1']);
    s.offers.items[0]!.mentionAll = true;
    await s.uc.execute();
    expect(s.sender.send).toHaveBeenCalledWith(expect.objectContaining({ mentionAll: true }));
  });

  it('envia vencidos com texto e foto; todos SENT → oferta SENT', async () => {
    const s = setup();
    expect(await s.uc.execute()).toEqual({ processed: 2 });
    expect(s.sender.send).toHaveBeenCalledWith({ tenantId: TENANT, conversationId: 'c1', text: 'oferta', imageUrl: 'store://1.jpg', mentionAll: false,
      simulateTyping: false, typingSeconds: 15,
    });
    expect(statuses(s)).toEqual([['SENT', 'm1'], ['SENT', 'm1']]);
    expect(s.offers.items[0]!.status).toBe('SENT');
  });

  it('não envia antes do notBefore e não fecha a oferta com envio aberto', async () => {
    const s = setup(['c1']);
    s.dispatches.add({ offerId: 'offer-1', conversationId: 'c2', notBefore: new Date(NOW.getTime() + 10_000) });
    expect(await s.uc.execute()).toEqual({ processed: 1 });
    expect(s.dispatches.items[1]!.status).toBe('QUEUED');
    expect(s.offers.items[0]!.status).toBe('SENDING');
  });

  it('falha de um não para os outros; um SENT basta para oferta SENT', async () => {
    const s = setup(['c1', 'c2', 'c3']);
    s.sender.send
      .mockRejectedValueOnce(new SessionNotConnectedError('s1'))
      .mockRejectedValueOnce(new NotFoundError('Conversation', 'c2'));
    await s.uc.execute();
    expect(statuses(s)).toEqual([
      ['FAILED', 'SESSION_NOT_CONNECTED'],
      ['SKIPPED', 'NOT_FOUND'],
      ['SENT', 'm1'],
    ]);
    expect(s.offers.items[0]!.status).toBe('SENT');
  });

  it('erro desconhecido → FAILED MESSAGE_SEND_FAILED; nenhum enviado → oferta FAILED', async () => {
    const s = setup(['c1']);
    s.sender.send.mockRejectedValueOnce(new Error('boom com texto'));
    await s.uc.execute();
    expect(statuses(s)).toEqual([['FAILED', 'MESSAGE_SEND_FAILED']]);
    expect(s.offers.items[0]!.status).toBe('FAILED');
  });

  it('só SKIPPED → oferta FAILED', async () => {
    const s = setup(['c1']);
    s.sender.send.mockRejectedValueOnce(new NotFoundError('Conversation'));
    await s.uc.execute();
    expect(s.offers.items[0]!.status).toBe('FAILED');
  });

  it('oferta sumiu ou não está SENDING (pausada) → envio não é reivindicado nem enviado', async () => {
    const s = setup(['c1']);
    s.offers.items = [];
    await s.uc.execute();
    expect(statuses(s)).toEqual([['QUEUED', null]]);
    expect(s.sender.send).not.toHaveBeenCalled();
  });

  it('SENDING órfão há > 5 min volta à fila e é enviado', async () => {
    const s = setup([]);
    s.dispatches.add({ offerId: 'offer-1', conversationId: 'c1', status: 'SENDING', claimedAt: new Date(NOW.getTime() - 6 * 60_000) });
    s.dispatches.add({ offerId: 'offer-1', conversationId: 'c2', status: 'SENDING', claimedAt: new Date(NOW.getTime() - 60_000) });
    expect(await s.uc.execute()).toEqual({ processed: 1 });
    expect(s.dispatches.items.map((d) => d.status)).toEqual(['SENT', 'SENDING']);
    expect(s.offers.items[0]!.status).toBe('SENDING');
  });

  it('respeita o lote', async () => {
    const s = setup(Array.from({ length: 12 }, (_, i) => `c${i}`));
    expect(await s.uc.execute()).toEqual({ processed: 10 });
  });

  it('fila vazia', async () => {
    const s = setup([]);
    expect(await s.uc.execute()).toEqual({ processed: 0 });
  });
  it('mídia ausente → FAILED; destino indisponível → SKIPPED', async () => {
    const s = setup(['c1', 'c2']);
    s.sender.send
      .mockRejectedValueOnce(new MediaNotFoundError())
      .mockRejectedValueOnce(new OfferDestinationUnavailableError('c2'));
    await s.uc.execute();
    expect(statuses(s)).toEqual([
      ['FAILED', 'MEDIA_NOT_FOUND'],
      ['SKIPPED', 'OFFER_DESTINATION_UNAVAILABLE'],
    ]);
  });

  it('envio travado → FAILED SEND_TIMEOUT', async () => {
    const s = setup(['c1']);
    s.sender.send.mockReturnValueOnce(new Promise(() => {}));
    await s.uc.execute();
    expect(statuses(s)).toEqual([['FAILED', 'SEND_TIMEOUT']]);
    expect(s.offers.items[0]!.status).toBe('FAILED');
  });

  it('posse perdida antes do envio (token trocado) → não envia nem sobrescreve', async () => {
    const s = setup(['c1']);
    const orig = s.dispatches.claimDue.bind(s.dispatches);
    s.dispatches.claimDue = async (now, limit) => {
      const claimed = await orig(now, limit);
      s.dispatches.items[0]!.claimToken = 'outro-worker';
      return claimed;
    };
    await s.uc.execute();
    expect(s.sender.send).not.toHaveBeenCalled();
    expect(s.dispatches.items[0]!.status).toBe('SENDING');
  });

  it('markResult exige o token da posse', async () => {
    const s = setup(['c1']);
    const [d] = await s.dispatches.claimDue(NOW, 1);
    expect(await s.dispatches.markResult(d!.id, TENANT, 'errado', { status: 'SENT', chatMessageId: 'x' })).toBe(false);
    expect(await s.dispatches.markResult(d!.id, TENANT, d!.claimToken!, { status: 'SENT', chatMessageId: 'x' })).toBe(true);
  });

  it('releaseStale não devolve envio com chatMessageId', async () => {
    const s = setup([]);
    s.dispatches.add({
      offerId: 'offer-1', conversationId: 'c1', status: 'SENDING', chatMessageId: 'm9',
      claimedAt: new Date(NOW.getTime() - 6 * 60_000),
    });
    expect(await s.dispatches.releaseStale(NOW)).toBe(0);
  });

  it('erro de banco num envio não para os outros', async () => {
    const s = setup(['c1', 'c2']);
    const orig = s.dispatches.markResult.bind(s.dispatches);
    s.dispatches.markResult = vi.fn().mockRejectedValueOnce(new Error('db')).mockImplementation(orig);
    expect(await s.uc.execute()).toEqual({ processed: 2 });
    expect(s.dispatches.items.map((d) => d.status)).toEqual(['SENDING', 'SENT']);
  });

  it('varredura fecha oferta SENDING sem envio aberto', async () => {
    const s = setup([]);
    s.dispatches.add({ offerId: 'offer-1', conversationId: 'c1', status: 'SENT', chatMessageId: 'm1' });
    await s.uc.execute();
    expect(s.offers.items[0]!.status).toBe('SENT');
  });
});

describe('ProcessDueOfferDispatchesUseCase — validade', () => {
  it('oferta vencida não sai: SKIPPED OFFER_EXPIRED e a oferta fecha sem envio', async () => {
    const s = setup(['c1']);
    s.offers.items[0]!.expiresAt = NOW;
    await s.uc.execute();
    expect(s.sender.send).not.toHaveBeenCalled();
    expect(statuses(s)).toEqual([['SKIPPED', 'OFFER_EXPIRED']]);
    expect(s.offers.items[0]!.status).toBe('FAILED');
  });

  it('oferta ainda válida sai normalmente', async () => {
    const s = setup(['c1']);
    s.offers.items[0]!.expiresAt = new Date(NOW.getTime() + 1000);
    await s.uc.execute();
    expect(statuses(s)).toEqual([['SENT', 'm1']]);
  });
});

describe('ProcessDueOfferDispatchesUseCase — sessão fora do ar', () => {
  const offline = (s: ReturnType<typeof setup>) => {
    for (const d of s.dispatches.items) d.sessionId = 's1';
    s.sender.send.mockRejectedValue(new SessionNotConnectedError('s1'));
  };

  it('volta para a fila (não falha), tenta de novo em 1 min e guarda desde quando espera', async () => {
    const s = setup(['c1']);
    offline(s);
    await s.uc.execute();
    const d = s.dispatches.items[0]!;
    expect(d).toMatchObject({ status: 'QUEUED', claimToken: null, failureReason: null, waitingSessionSince: NOW });
    expect(d.notBefore).toEqual(new Date(NOW.getTime() + OFFLINE_RETRY_MS));
    expect(s.offers.items[0]!.status).toBe('SENDING');
  });

  it('nova tentativa mantém o início da espera; sessão voltou → envia', async () => {
    const s = setup(['c1']);
    offline(s);
    const since = new Date(NOW.getTime() - 3_600_000);
    s.dispatches.items[0]!.waitingSessionSince = since;
    await s.uc.execute();
    expect(s.dispatches.items[0]!.waitingSessionSince).toEqual(since);
    s.sender.send.mockResolvedValue({ chatMessageId: 'm1' });
    s.dispatches.items[0]!.notBefore = NOW;
    await s.uc.execute();
    expect(statuses(s)).toEqual([['SENT', 'm1']]);
  });

  it('fora do ar há mais de 6 h: desiste dos atrasados e do resto da oferta (sem nova janela)', async () => {
    const s = setup(['c1', 'c2']);
    offline(s);
    s.dispatches.items[0]!.waitingSessionSince = new Date(NOW.getTime() - OFFLINE_MAX_WAIT_MS);
    // o 2º ainda é futuro: sem isto ele ganharia outra janela de 6 h
    s.dispatches.items[1]!.notBefore = new Date(NOW.getTime() + 3_600_000);
    // só o 1º é reivindicado (lote de 1); o 2º, atrasado, falha junto
    const uc = new ProcessDueOfferDispatchesUseCase({ offers: s.offers, dispatches: s.dispatches, sender: s.sender, now: () => NOW, batchSize: 1 });
    await uc.execute();
    expect(statuses(s)).toEqual([['FAILED', 'SESSION_NOT_CONNECTED'], ['FAILED', 'SESSION_NOT_CONNECTED']]);
    expect(s.offers.items[0]!.status).toBe('FAILED');
  });

  it('desistência não toca oferta pausada da mesma sessão', async () => {
    const s = setup(['c1']);
    offline(s);
    s.dispatches.items[0]!.waitingSessionSince = new Date(NOW.getTime() - OFFLINE_MAX_WAIT_MS);
    s.offers.items.push(makeOffer({ id: 'pausada', status: 'PAUSED' }));
    s.dispatches.add({ offerId: 'pausada', conversationId: 'p1', sessionId: 's1', notBefore: new Date(NOW.getTime() - 1000) });
    await s.uc.execute();
    expect(s.dispatches.items.find((d) => d.offerId === 'pausada')!.status).toBe('QUEUED');
  });

  it('ENGINE_NOT_READY não volta para a fila (é também o erro genérico do envio de texto)', async () => {
    const s = setup(['c1']);
    for (const d of s.dispatches.items) d.sessionId = 's1';
    s.sender.send.mockRejectedValue(new AppError('ENGINE_NOT_READY', 'x', 503));
    await s.uc.execute();
    expect(statuses(s)).toEqual([['FAILED', 'ENGINE_NOT_READY']]);
  });

  it('oferta parada enquanto o envio estava saindo: não volta para a fila', async () => {
    const s = setup(['c1']);
    offline(s);
    s.sender.send.mockImplementation(async () => { s.offers.items[0]!.status = 'CANCELLED'; throw new SessionNotConnectedError('s1'); });
    await s.uc.execute();
    expect(s.dispatches.items[0]!.status).toBe('SENDING'); // releaseStale fecha como CANCELLED
  });

  it('envio sem sessão registrada (legado) continua falhando como antes', async () => {
    const s = setup(['c1']);
    s.sender.send.mockRejectedValue(new SessionNotConnectedError('s1'));
    await s.uc.execute();
    expect(statuses(s)).toEqual([['FAILED', 'SESSION_NOT_CONNECTED']]);
  });

  it('erro no meio do envio (conexão caiu) não volta para a fila: pode ter saído', async () => {
    const s = setup(['c1']);
    for (const d of s.dispatches.items) d.sessionId = 's1';
    s.sender.send.mockRejectedValue(new AppError('RECOVERABLE_CONNECTION_ERROR', 'x', 503));
    await s.uc.execute();
    expect(statuses(s)).toEqual([['FAILED', 'RECOVERABLE_CONNECTION_ERROR']]);
  });
});
