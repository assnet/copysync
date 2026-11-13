import { afterEach, describe, it, expect, vi } from 'vitest';
import { logger } from '../../../../shared/logger/logger';
import { FLOOD_MAX_WAIT_MS, FLOOD_WAIT_MARGIN_MS, OFFLINE_MAX_WAIT_MS, OFFLINE_RETRY_MS, ProcessDueOfferDispatchesUseCase } from './ProcessDueOfferDispatchesUseCase';
import { TelegramFloodWaitError } from '../../../../shared/errors/internal/TelegramErrors';
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
  it('sessão excluída: QUEUED (vencido ou futuro) fecha SKIPPED SESSION_DELETED no tick, sem chamar o sender nem esperar 6 h; oferta fecha', async () => {
    const s = setup([]);
    s.dispatches.add({ offerId: 'offer-1', conversationId: 'c1', sessionId: 'gone' });
    s.dispatches.add({ offerId: 'offer-1', conversationId: 'c2', sessionId: 'gone', notBefore: new Date(NOW.getTime() + 3_600_000) });
    s.dispatches.deletedSessionIds.add('gone');
    expect(await s.uc.execute()).toEqual({ processed: 0 });
    expect(s.sender.send).not.toHaveBeenCalled();
    expect(statuses(s)).toEqual([['SKIPPED', 'SESSION_DELETED'], ['SKIPPED', 'SESSION_DELETED']]);
    expect(s.offers.items[0]!.status).toBe('FAILED');
  });

  it('sessão excluída não afeta as outras: a viva envia no mesmo tick e a viva fora do ar segue esperando', async () => {
    const s = setup([]);
    s.dispatches.add({ offerId: 'offer-1', conversationId: 'c1', sessionId: 'gone' });
    s.dispatches.add({ offerId: 'offer-1', conversationId: 'c2', sessionId: 'live' });
    s.dispatches.add({ offerId: 'offer-1', conversationId: 'c3', sessionId: 'offline' });
    s.dispatches.deletedSessionIds.add('gone');
    s.sender.send.mockImplementation(async (i: { conversationId: string }) => {
      if (i.conversationId === 'c3') throw new SessionNotConnectedError('offline');
      return { chatMessageId: 'm1' };
    });
    expect(await s.uc.execute()).toEqual({ processed: 2 });
    expect(statuses(s)).toEqual([['SKIPPED', 'SESSION_DELETED'], ['SENT', 'm1'], ['QUEUED', null]]);
    expect(s.dispatches.items[2]!.waitingSessionSince).toEqual(NOW);
    expect(s.offers.items[0]!.status).toBe('SENDING');
  });

  it('oferta com mentionAll repassa a flag ao sender', async () => {
    const s = setup(['c1']);
    s.offers.items[0]!.mentionAll = true;
    await s.uc.execute();
    expect(s.sender.send).toHaveBeenCalledWith(expect.objectContaining({ mentionAll: true }));
  });

  it('repassa imageMode, título e link de afiliado ao sender (prévia do link)', async () => {
    const s = setup(['c1']);
    Object.assign(s.offers.items[0]!, { imageMode: 'LINK_PREVIEW', title: 'Fone' });
    await s.uc.execute();
    expect(s.sender.send).toHaveBeenCalledWith(expect.objectContaining({
      imageMode: 'LINK_PREVIEW', title: 'Fone', affiliateUrl: 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=t-20',
    }));
  });

  it('envia vencidos com texto e foto; todos SENT → oferta SENT; oferta salva MEDIA sai LINK_PREVIEW (MEDIA desligado)', async () => {
    const s = setup();
    expect(s.offers.items[0]!.imageMode).toBe('MEDIA');
    expect(await s.uc.execute()).toEqual({ processed: 2 });
    expect(s.sender.send).toHaveBeenCalledWith({ tenantId: TENANT, conversationId: 'c1', text: 'oferta', imageUrl: 'store://1.jpg', mentionAll: false,
      imageMode: 'LINK_PREVIEW', title: null, affiliateUrl: 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=t-20',
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

describe('ProcessDueOfferDispatchesUseCase — FLOOD_WAIT (Telegram)', () => {
  it('reagenda para depois da espera pedida, sem falhar nem fechar a oferta', async () => {
    const s = setup(['c1']);
    s.dispatches.items[0]!.sessionId = 's1';
    s.sender.send.mockRejectedValueOnce(new TelegramFloodWaitError(30));
    await s.uc.execute();
    const d = s.dispatches.items[0]!;
    // motivo marca o relógio como flood (não é queda de sessão); a UI só o lê em FAILED/SKIPPED
    expect(d).toMatchObject({ status: 'QUEUED', claimToken: null, failureReason: 'TELEGRAM_FLOOD_WAIT', waitingSessionSince: NOW });
    expect(d.notBefore).toEqual(new Date(NOW.getTime() + 30_000 + FLOOD_WAIT_MARGIN_MS));
    expect(s.offers.items[0]!.status).toBe('SENDING');
    // passada a espera, sai
    d.notBefore = NOW;
    await s.uc.execute();
    expect(statuses(s)).toEqual([['SENT', 'm1']]);
  });

  it('espera acima do teto (6 h) ou sem sessão registrada → FAILED TELEGRAM_FLOOD_WAIT', async () => {
    const s = setup(['c1', 'c2']);
    s.dispatches.items[0]!.sessionId = 's1';
    s.sender.send
      .mockRejectedValueOnce(new TelegramFloodWaitError(OFFLINE_MAX_WAIT_MS / 1000))
      .mockRejectedValueOnce(new TelegramFloodWaitError(5));
    await s.uc.execute();
    expect(statuses(s)).toEqual([['FAILED', 'TELEGRAM_FLOOD_WAIT'], ['FAILED', 'TELEGRAM_FLOOD_WAIT']]);
  });

  it('flood acumulado passa do teto (FLOOD repetido) → FAILED e atrasados da sessão juntos', async () => {
    const s = setup(['c1', 'c2']);
    for (const d of s.dispatches.items) d.sessionId = 's1';
    Object.assign(s.dispatches.items[0]!, {
      waitingSessionSince: new Date(NOW.getTime() - FLOOD_MAX_WAIT_MS + 60_000), failureReason: 'TELEGRAM_FLOOD_WAIT',
    });
    s.sender.send.mockRejectedValueOnce(new TelegramFloodWaitError(120));
    const uc = new ProcessDueOfferDispatchesUseCase({ offers: s.offers, dispatches: s.dispatches, sender: s.sender, now: () => NOW, batchSize: 1 });
    await uc.execute();
    expect(statuses(s)).toEqual([['FAILED', 'TELEGRAM_FLOOD_WAIT'], ['FAILED', 'TELEGRAM_FLOOD_WAIT']]);
  });

  it('flood longo seguido de queda: a sessão fora do ar ganha a própria janela de 6 h', async () => {
    const s = setup(['c1']);
    s.dispatches.items[0]!.sessionId = 's1';
    s.sender.send.mockRejectedValue(new SessionNotConnectedError('s1'));
    Object.assign(s.dispatches.items[0]!, {
      waitingSessionSince: new Date(NOW.getTime() - 5 * 3_600_000), failureReason: 'TELEGRAM_FLOOD_WAIT',
    });
    await s.uc.execute();
    expect(s.dispatches.items[0]).toMatchObject({ status: 'QUEUED', waitingSessionSince: NOW, failureReason: null });
  });

  it('queda longa seguida de flood: o relógio do flood começa agora', async () => {
    const s = setup(['c1']);
    s.dispatches.items[0]!.sessionId = 's1';
    s.dispatches.items[0]!.waitingSessionSince = new Date(NOW.getTime() - 5 * 3_600_000);
    s.sender.send.mockRejectedValueOnce(new TelegramFloodWaitError(3_600));
    await s.uc.execute();
    expect(s.dispatches.items[0]).toMatchObject({ status: 'QUEUED', waitingSessionSince: NOW, failureReason: 'TELEGRAM_FLOOD_WAIT' });
  });
});

describe('ProcessDueOfferDispatchesUseCase — parada cooperativa e observação', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sem contexto: igual a antes (todos enviados)', async () => {
    const s = setup();
    expect(await s.uc.execute({})).toEqual({ processed: 2 });
    expect(statuses(s)).toEqual([['SENT', 'm1'], ['SENT', 'm1']]);
  });

  it('sinal já abortado: nem claim, nem stale, nem envio', async () => {
    const s = setup();
    const claim = vi.spyOn(s.dispatches, 'claimDue');
    const stale = vi.spyOn(s.dispatches, 'releaseStale');
    expect(await s.uc.execute({ signal: AbortSignal.abort() })).toEqual({ processed: 0 });
    expect(claim).not.toHaveBeenCalled();
    expect(stale).not.toHaveBeenCalled();
    expect(s.sender.send).not.toHaveBeenCalled();
  });

  it('parada durante o claim: itens pré-reivindicados ficam SENDING sem envio e voltam pelo stale', async () => {
    const s = setup();
    const ac = new AbortController();
    const original = s.dispatches.claimDue.bind(s.dispatches);
    vi.spyOn(s.dispatches, 'claimDue').mockImplementation(async (...a) => {
      const r = await original(...a);
      ac.abort();
      return r;
    });
    await s.uc.execute({ signal: ac.signal });
    expect(s.sender.send).not.toHaveBeenCalled();
    expect(s.dispatches.items.map((d) => [d.status, d.failureReason])).toEqual([['SENDING', null], ['SENDING', null]]);
    expect(s.offers.items[0]!.status).toBe('SENDING');
    // Recuperação de sempre: releaseStale devolve à fila, sem retry novo por parada
    await s.dispatches.releaseStale(new Date(NOW.getTime() + 1));
    expect(s.dispatches.items.map((d) => d.status)).toEqual(['QUEUED', 'QUEUED']);
  });

  it('parada entre o claim renovado e o sender: não envia nem marca', async () => {
    const s = setup(['c1']);
    const ac = new AbortController();
    const original = s.offers.findById.bind(s.offers);
    vi.spyOn(s.offers, 'findById').mockImplementation(async (...a) => {
      ac.abort();
      return original(...a);
    });
    await s.uc.execute({ signal: ac.signal });
    expect(s.sender.send).not.toHaveBeenCalled();
    expect(s.dispatches.items[0]).toMatchObject({ status: 'SENDING', failureReason: null, chatMessageId: null });
  });

  it('parada durante o sender: o envio termina, grava SENT/token e o próximo não começa', async () => {
    const s = setup(['c1', 'c2']);
    const ac = new AbortController();
    s.sender.send.mockImplementationOnce(async () => {
      ac.abort();
      return { chatMessageId: 'm9' };
    });
    await s.uc.execute({ signal: ac.signal });
    expect(s.sender.send).toHaveBeenCalledTimes(1);
    expect(statuses(s)).toEqual([['SENT', 'm9'], ['SENDING', null]]);
  });

  it('SEND_TIMEOUT tardio com parada: marca FAILED SEND_TIMEOUT, sem retry e sem novo envio', async () => {
    const s = setup(['c1', 'c2']);
    const ac = new AbortController();
    let finish!: (v: { chatMessageId: string }) => void;
    s.sender.send.mockImplementationOnce(() => new Promise((r) => {
      finish = r;
      setTimeout(() => ac.abort(), 10);
    }));
    await s.uc.execute({ signal: ac.signal });
    expect(statuses(s)).toEqual([['FAILED', 'SEND_TIMEOUT'], ['SENDING', null]]);
    finish({ chatMessageId: 'late' });
    await Promise.resolve();
    expect(s.sender.send).toHaveBeenCalledTimes(1);
    expect(statuses(s)[0]).toEqual(['FAILED', 'SEND_TIMEOUT']);
  });

  it('posse perdida antes do sender com sinal ativo: não envia; log de observação CLAIM_LOST', async () => {
    const s = setup(['c1']);
    vi.spyOn(s.dispatches, 'touchClaim').mockResolvedValue(false);
    const info = vi.spyOn(logger, 'info');
    await s.uc.execute({ signal: new AbortController().signal });
    expect(s.sender.send).not.toHaveBeenCalled();
    expect(info.mock.calls.find((c) => c[1] === 'offer dispatch observed')?.[0]).toMatchObject({ status: 'CLAIM_LOST' });
  });

  it('log por envio: atraso desde notBefore separado da duração do envio; sem texto nem link', async () => {
    const offers = new InMemoryOfferRepository();
    offers.items.push(makeOffer({ status: 'SENDING', text: 'oferta secreta', imageUrl: 'store://1.jpg' }));
    const dispatches = new InMemoryOfferDispatchRepository(offers);
    dispatches.add({ offerId: 'offer-1', conversationId: 'c1', sessionId: 's1', notBefore: new Date(NOW.getTime() - 45_000) });
    const sender = { send: vi.fn().mockResolvedValue({ chatMessageId: 'm1' }) };
    let t = 0;
    const uc = new ProcessDueOfferDispatchesUseCase({ offers, dispatches, sender, now: () => NOW, clock: () => (t += 700) });
    const info = vi.spyOn(logger, 'info');
    await uc.execute();
    expect(info.mock.calls.find((c) => c[1] === 'offer dispatch observed')?.[0]).toMatchObject({
      status: 'SENT', code: null, dispatchOverdueMs: 45_000, sendMs: 700, sessionId: 's1', tenantId: TENANT,
    });
    const dump = JSON.stringify(info.mock.calls);
    for (const secret of ['oferta secreta', 'http', 'store://']) expect(dump).not.toContain(secret);
  });

  it('log de falha leva só o código interno', async () => {
    const s = setup(['c1']);
    s.sender.send.mockRejectedValueOnce(new Error('boom com texto'));
    const info = vi.spyOn(logger, 'info');
    await s.uc.execute();
    const obs = info.mock.calls.find((c) => c[1] === 'offer dispatch observed')?.[0];
    expect(obs).toMatchObject({ status: 'FAILED', code: 'MESSAGE_SEND_FAILED' });
    expect(JSON.stringify(info.mock.calls)).not.toContain('boom com texto');
  });
});
