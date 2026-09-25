import { describe, it, expect } from 'vitest';
import type { ChatMessage } from '../types';
import {
  EARLY_STATUS_TTL_MS,
  applyEarlyStatus,
  failureKind,
  initialOutgoingMediaState,
  overlayOutgoing,
  reduceOutgoingMedia,
  type OutgoingMediaEvent,
  type OutgoingMediaState,
} from './outgoingMediaState';

const bolha = (tmpId: string, conversationId = 'c1'): ChatMessage => ({
  id: tmpId,
  conversationId,
  type: 'image',
  direction: 'out',
  body: null,
  mediaUrl: `blob:http://localhost/${tmpId}`,
  timestamp: '2026-09-25T10:00:00.000Z',
  status: 'sending',
});

const real = (id: string, status: ChatMessage['status'] = 'sending'): ChatMessage => ({
  id,
  conversationId: 'c1',
  type: 'image',
  direction: 'out',
  body: null,
  mediaUrl: `/media/${id}.jpg`,
  timestamp: '2026-09-25T10:00:05.000Z',
  status,
});

const texto = (id: string): ChatMessage => ({
  id,
  conversationId: 'c1',
  type: 'text',
  direction: 'in',
  body: id,
  timestamp: '2026-09-25T09:00:00.000Z',
  status: 'read',
});

const run = (state: OutgoingMediaState, ...events: OutgoingMediaEvent[]) =>
  events.reduce((s, e) => reduceOutgoingMedia(s, e).state, state);

const item = (s: OutgoingMediaState, tmpId: string, conversationId = 'c1') =>
  s.byConversation[conversationId]?.find((i) => i.tmpId === tmpId);

/** Bolha adicionada e com upload criado no servidor. */
const subindo = run(
  initialOutgoingMediaState,
  { type: 'ADDED', message: bolha('tmp-1') },
  { type: 'UPLOAD_STARTED', tmpId: 'tmp-1', uploadId: 'up-1' },
);
const confirmando = run(subindo, { type: 'PROGRESS', tmpId: 'tmp-1', progress: 100 }, { type: 'CONFIRMING', tmpId: 'tmp-1' });

describe('failureKind — decisão por erro (design §14)', () => {
  it.each([
    ['abortado pelo operador', { status: 413, code: 'MEDIA_TOO_LARGE' }, true, 'canceled'],
    ['sem status (rede)', { code: 'ERR_NETWORK' }, false, 'network'],
    ['sem erro nenhum', null, false, 'network'],
    ['sessão desconectada', { status: 409, code: 'SESSION_NOT_CONNECTED' }, false, 'session'],
    ['confirmação concorrente', { status: 409, code: 'UPLOAD_IN_PROGRESS' }, false, 'in_progress'],
    ['partes faltando', { status: 409, code: 'UPLOAD_INCOMPLETE' }, false, 'incomplete'],
    ['upload expirado', { status: 404, code: 'UPLOAD_NOT_FOUND' }, false, 'not_found'],
    ['arquivo grande demais', { status: 413, code: 'MEDIA_TOO_LARGE' }, false, 'rejected'],
    ['413 do próprio Fastify', { status: 413, code: 'HTTP_ERROR' }, false, 'rejected'],
    ['tipo não suportado', { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' }, false, 'rejected'],
    ['processamento falhou', { status: 422, code: 'MEDIA_PROCESSING_FAILED' }, false, 'rejected'],
    ['400 do próprio Fastify', { status: 400, code: 'HTTP_ERROR' }, false, 'rejected'],
    ['erro interno', { status: 500, code: 'INTERNAL_ERROR' }, false, 'network'],
    ['processador indisponível', { status: 503, code: 'MEDIA_PROCESSOR_UNAVAILABLE' }, false, 'network'],
    ['disco sem folga', { status: 507, code: 'INSUFFICIENT_STORAGE' }, false, 'network'],
    ['muitas requisições', { status: 429, code: 'TOO_MANY_REQUESTS' }, false, 'network'],
  ] as const)('%s', (_nome, error, aborted, esperado) => {
    expect(failureKind(error, aborted)).toBe(esperado);
  });
});

describe('estado das bolhas em envio — tabela do design §14', () => {
  it('bolha adicionada aparece subindo, com 0% e sem erro', () => {
    const s = run(initialOutgoingMediaState, { type: 'ADDED', message: bolha('tmp-1') });
    const i = item(s, 'tmp-1');
    expect(i).toMatchObject({ tmpId: 'tmp-1', conversationId: 'c1', phase: 'uploading', progress: 0, error: null });
    expect(i?.message.status).toBe('sending');
    expect(i?.message.upload).toEqual({ phase: 'uploading', progress: 0, error: null });
  });

  it('parte concluída: o percentual avança na bolha', () => {
    const s = run(subindo, { type: 'PROGRESS', tmpId: 'tmp-1', progress: 42 });
    expect(item(s, 'tmp-1')?.progress).toBe(42);
    expect(item(s, 'tmp-1')?.message.upload).toEqual({ phase: 'uploading', progress: 42, uploadId: 'up-1', error: null });
  });

  it('progresso não regride e fica entre 0 e 100', () => {
    const s = run(subindo, { type: 'PROGRESS', tmpId: 'tmp-1', progress: 60 }, { type: 'PROGRESS', tmpId: 'tmp-1', progress: 30 });
    expect(item(s, 'tmp-1')?.progress).toBe(60);
    expect(item(run(s, { type: 'PROGRESS', tmpId: 'tmp-1', progress: 140 }), 'tmp-1')?.progress).toBe(100);
    // Sem mudança, o mesmo objeto: o React não re-renderiza.
    expect(reduceOutgoingMedia(s, { type: 'PROGRESS', tmpId: 'tmp-1', progress: 10 }).state).toBe(s);
  });

  it('202/200: a bolha sai, o blob é devolvido para revogar e a mensagem real segue para a lista', () => {
    const r = reduceOutgoingMedia(confirmando, { type: 'CONFIRMED', tmpId: 'tmp-1', message: real('m-1') });
    expect(r.state.byConversation.c1).toBeUndefined();
    expect(r.revoke).toEqual(['blob:http://localhost/tmp-1']);
    expect(r.confirmed).toEqual(real('m-1'));
  });

  it('WS de status com id ainda desconhecido fica guardado e expira em 2 min', () => {
    const s = run(confirmando, { type: 'WS_STATUS', messageId: 'm-1', status: 'sent', at: 1_000 });
    expect(s.earlyStatusById['m-1']).toEqual({ status: 'sent', at: 1_000 });

    const antes = run(s, { type: 'PRUNE', now: 1_000 + EARLY_STATUS_TTL_MS - 1 });
    expect(antes).toBe(s);
    const depois = run(s, { type: 'PRUNE', now: 1_000 + EARLY_STATUS_TTL_MS });
    expect(depois.earlyStatusById).toEqual({});
  });

  it('rede esgotada: bolha falha com "network" e "Tentar de novo" retoma pelo mesmo upload', () => {
    const falhou = run(subindo, { type: 'PROGRESS', tmpId: 'tmp-1', progress: 50 }, { type: 'FAILED', tmpId: 'tmp-1', kind: 'network' });
    expect(item(falhou, 'tmp-1')).toMatchObject({ phase: 'uploading', error: 'network', uploadId: 'up-1', progress: 50 });
    expect(item(falhou, 'tmp-1')?.message.upload?.error).toBe('network');

    const retomou = run(falhou, { type: 'RETRY', tmpId: 'tmp-1' });
    expect(item(retomou, 'tmp-1')).toMatchObject({ phase: 'uploading', error: null, uploadId: 'up-1', progress: 50 });
  });

  it('rede cai na confirmação: "Tentar de novo" só reconfirma', () => {
    const s = run(confirmando, { type: 'FAILED', tmpId: 'tmp-1', kind: 'network' }, { type: 'RETRY', tmpId: 'tmp-1' });
    expect(item(s, 'tmp-1')).toMatchObject({ phase: 'confirming', error: null, uploadId: 'up-1' });
  });

  it('SESSION_NOT_CONNECTED: falha com "session" e "Tentar de novo" só reconfirma', () => {
    const falhou = run(confirmando, { type: 'FAILED', tmpId: 'tmp-1', kind: 'session' });
    expect(item(falhou, 'tmp-1')).toMatchObject({ phase: 'confirming', error: 'session' });

    const retomou = run(falhou, { type: 'RETRY', tmpId: 'tmp-1' });
    expect(item(retomou, 'tmp-1')).toMatchObject({ phase: 'confirming', error: null, uploadId: 'up-1', progress: 100 });
  });

  it('UPLOAD_IN_PROGRESS: segue confirmando, sem erro visível', () => {
    const s = run(confirmando, { type: 'FAILED', tmpId: 'tmp-1', kind: 'in_progress' });
    expect(item(s, 'tmp-1')).toMatchObject({ phase: 'confirming', error: null, uploadId: 'up-1' });
    expect(s).toBe(confirmando);
  });

  it('UPLOAD_INCOMPLETE: volta a subir as partes do mesmo upload', () => {
    const s = run(confirmando, { type: 'FAILED', tmpId: 'tmp-1', kind: 'incomplete' });
    expect(item(s, 'tmp-1')).toMatchObject({ phase: 'uploading', error: null, uploadId: 'up-1', progress: 100 });
  });

  it('UPLOAD_NOT_FOUND: sobe de novo do arquivo, sem o upload antigo e do zero', () => {
    const s = run(confirmando, { type: 'FAILED', tmpId: 'tmp-1', kind: 'not_found' });
    const i = item(s, 'tmp-1');
    expect(i).toMatchObject({ phase: 'uploading', error: null, progress: 0 });
    expect(i?.uploadId).toBeUndefined();
    expect(i?.message.upload).toEqual({ phase: 'uploading', progress: 0, error: null });

    // O novo upload recomeça a contagem a partir do zero.
    const novo = run(s, { type: 'UPLOAD_STARTED', tmpId: 'tmp-1', uploadId: 'up-2' }, { type: 'PROGRESS', tmpId: 'tmp-1', progress: 10 });
    expect(item(novo, 'tmp-1')).toMatchObject({ uploadId: 'up-2', progress: 10 });
  });

  it('413/415/422: falha com "rejected", sem tentar de novo — só descartar', () => {
    const falhou = run(subindo, { type: 'FAILED', tmpId: 'tmp-1', kind: 'rejected' });
    expect(item(falhou, 'tmp-1')?.error).toBe('rejected');
    expect(run(falhou, { type: 'RETRY', tmpId: 'tmp-1' })).toBe(falhou);

    const descartou = reduceOutgoingMedia(falhou, { type: 'CANCELED', tmpId: 'tmp-1' });
    expect(descartou.state.byConversation).toEqual({});
    expect(descartou.revoke).toEqual(['blob:http://localhost/tmp-1']);
  });

  it('cancelar: a bolha some e o blob é devolvido para revogar', () => {
    const r = reduceOutgoingMedia(subindo, { type: 'CANCELED', tmpId: 'tmp-1' });
    expect(r.state.byConversation).toEqual({});
    expect(r.revoke).toEqual(['blob:http://localhost/tmp-1']);

    // Erro de requisição abortada tem o mesmo efeito, e repetir não quebra.
    const abortou = reduceOutgoingMedia(subindo, { type: 'FAILED', tmpId: 'tmp-1', kind: 'canceled' });
    expect(abortou.state.byConversation).toEqual({});
    expect(abortou.revoke).toEqual(['blob:http://localhost/tmp-1']);
    expect(reduceOutgoingMedia(r.state, { type: 'CANCELED', tmpId: 'tmp-1' })).toEqual({ state: r.state, revoke: [] });
  });

  it('FAILED do servidor: a mensagem real entra como falhou, com o reenvio da própria mensagem', () => {
    const recusadoNaFila = reduceOutgoingMedia(confirmando, { type: 'CONFIRMED', tmpId: 'tmp-1', message: real('m-1', 'failed') });
    expect(recusadoNaFila.confirmed?.status).toBe('failed');

    const falhaAntesDo202 = run(confirmando, { type: 'WS_STATUS', messageId: 'm-1', status: 'failed', at: 1 });
    const r = reduceOutgoingMedia(falhaAntesDo202, { type: 'CONFIRMED', tmpId: 'tmp-1', message: real('m-1') });
    expect(r.confirmed?.status).toBe('failed');
    expect(r.confirmed?.upload).toBeUndefined();
  });
});

describe('WS antes do 202', () => {
  it('status antecipado é aplicado na troca pela mensagem real e consumido', () => {
    const s = run(confirmando, { type: 'WS_STATUS', messageId: 'm-1', status: 'sent', at: 1 });
    const r = reduceOutgoingMedia(s, { type: 'CONFIRMED', tmpId: 'tmp-1', message: real('m-1') });
    expect(r.confirmed?.status).toBe('sent');
    expect(r.state.earlyStatusById).toEqual({});
  });

  it('applyEarlyStatus só troca mensagem ainda enviando; sem antecipado devolve o mesmo objeto', () => {
    const early = { 'm-1': { status: 'sent' as const, at: 1 } };
    expect(applyEarlyStatus(real('m-1'), early).status).toBe('sent');
    const lida = real('m-1', 'read');
    expect(applyEarlyStatus(lida, early)).toBe(lida);
    const outra = real('m-2');
    expect(applyEarlyStatus(outra, early)).toBe(outra);
  });
});

describe('sobreposição na lista renderizada', () => {
  const lote = run(
    initialOutgoingMediaState,
    { type: 'ADDED', message: bolha('tmp-1') },
    { type: 'ADDED', message: bolha('tmp-2') },
    { type: 'ADDED', message: bolha('tmp-3', 'c2') },
  );

  it('bolhas em envio ficam ao fim, na ordem de criação, só na própria conversa', () => {
    const lista = overlayOutgoing([texto('a'), texto('b')], lote.byConversation.c1);
    expect(lista.map((m) => m.id)).toEqual(['a', 'b', 'tmp-1', 'tmp-2']);
    expect(overlayOutgoing([], lote.byConversation.c2).map((m) => m.id)).toEqual(['tmp-3']);
  });

  it('busca, reabertura ou página substituem a lista do servidor e as bolhas continuam', () => {
    const reaberta = overlayOutgoing([texto('x')], lote.byConversation.c1);
    const paginada = overlayOutgoing([texto('antiga'), texto('x')], lote.byConversation.c1);
    const vazia = overlayOutgoing([], lote.byConversation.c1);
    expect(reaberta.map((m) => m.id)).toEqual(['x', 'tmp-1', 'tmp-2']);
    expect(paginada.map((m) => m.id)).toEqual(['antiga', 'x', 'tmp-1', 'tmp-2']);
    expect(vazia.map((m) => m.id)).toEqual(['tmp-1', 'tmp-2']);
  });

  it('não duplica quando o id real já está na lista do servidor', () => {
    const ligado = run(lote, { type: 'LINKED', tmpId: 'tmp-1', messageId: 'm-1' });
    expect(item(ligado, 'tmp-1')?.realMessageId).toBe('m-1');
    const lista = overlayOutgoing([texto('a'), real('m-1')], ligado.byConversation.c1);
    expect(lista.map((m) => m.id)).toEqual(['a', 'm-1', 'tmp-2']);
  });

  it('sem bolhas em envio devolve a própria lista do servidor', () => {
    const servidor = [texto('a')];
    expect(overlayOutgoing(servidor, undefined)).toBe(servidor);
    expect(overlayOutgoing(servidor, [])).toBe(servidor);
  });
});

describe('robustez do redutor', () => {
  it('evento para bolha inexistente não muda o estado', () => {
    const eventos: OutgoingMediaEvent[] = [
      { type: 'UPLOAD_STARTED', tmpId: 'x', uploadId: 'u' },
      { type: 'PROGRESS', tmpId: 'x', progress: 10 },
      { type: 'CONFIRMING', tmpId: 'x' },
      { type: 'FAILED', tmpId: 'x', kind: 'network' },
      { type: 'RETRY', tmpId: 'x' },
      { type: 'LINKED', tmpId: 'x', messageId: 'm' },
      { type: 'CANCELED', tmpId: 'x' },
    ];
    for (const e of eventos) expect(reduceOutgoingMedia(subindo, e)).toEqual({ state: subindo, revoke: [] });
  });

  it('a mesma bolha adicionada duas vezes não se repete', () => {
    expect(run(subindo, { type: 'ADDED', message: bolha('tmp-1') })).toBe(subindo);
  });

  it('confirmação que chega depois do cancelamento ainda devolve a mensagem real', () => {
    const cancelado = run(confirmando, { type: 'CANCELED', tmpId: 'tmp-1' });
    const r = reduceOutgoingMedia(cancelado, { type: 'CONFIRMED', tmpId: 'tmp-1', message: real('m-1') });
    expect(r.confirmed?.id).toBe('m-1');
    expect(r.revoke).toEqual([]);
  });
});
