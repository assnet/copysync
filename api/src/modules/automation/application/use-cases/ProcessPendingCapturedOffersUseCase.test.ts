import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../../../shared/logger/logger';
import { CAPTURE_TICK_BUDGET_MS, ProcessPendingCapturedOffersUseCase } from './ProcessPendingCapturedOffersUseCase';
import { RegisterCapturedMessageUseCase } from './RegisterCapturedMessageUseCase';
import { DEFAULT_MONITOR_SETTINGS } from '../../domain/services/monitorSettings';
import {
  FakeEntitlements, FakeImageStore, FakeLinkBuilder, FakeOfferQueue, FakeProductReader, FakeTextComposer, InMemoryCapturedOfferRepository, InMemoryGroupMonitorRepository, NOW, SESSION, TENANT,
} from './monitorTestFakes';

const TEXT = '🔥 Fone JBL por R$ 99\nhttps://amzn.to/abc?tag=concorrente-20\nCupom: PROMO10\n👉 Grupo: https://chat.whatsapp.com/XYZ';

async function setup(opts: { settings?: Partial<typeof DEFAULT_MONITOR_SETTINGS> & { weekdays?: number[] }; broadcast?: string[]; entitlements?: Record<string, unknown>; processNow?: () => Date; captureNow?: () => Date } = {}) {
  const monitors = new InMemoryGroupMonitorRepository();
  const captured = new InMemoryCapturedOfferRepository();
  const links = new FakeLinkBuilder();
  const queue = new FakeOfferQueue();
  const products = new FakeProductReader();
  const texts = new FakeTextComposer();
  const images = new FakeImageStore();
  const cfg = await monitors.saveSettings(TENANT, SESSION, { ...DEFAULT_MONITOR_SETTINGS, enabled: true, ...opts.settings });
  await monitors.replaceMonitored(TENANT, SESSION, cfg.id, [{ conversationId: 'c-src', groupJid: '120363-src', keywords: [] }]);
  await monitors.replaceBroadcast(TENANT, SESSION, cfg.id, (opts.broadcast ?? ['g1', 'g2']).map((j) => ({ conversationId: `c-${j}`, groupJid: j, sessionId: SESSION })));
  const register = new RegisterCapturedMessageUseCase({ monitors, captured, now: opts.captureNow ?? (() => NOW) });
  const process = new ProcessPendingCapturedOffersUseCase({
    captured, monitors, links, queue, entitlements: new FakeEntitlements(opts.entitlements), now: opts.processNow ?? opts.captureNow ?? (() => NOW), products, texts, images,
  });
  const msg = (o = {}) => register.execute({
    tenantId: TENANT, sessionId: SESSION, isGroup: true, fromMe: false, groupJid: '120363-src', externalMessageId: 'm1',
    body: TEXT, msgType: 'IMAGE', mediaUrl: 'https://api/media/1.jpg', mimeType: 'image/jpeg', ...o,
  });
  return { monitors, captured, links, queue, products, texts, images, register, process, msg };
}

describe('RegisterCapturedMessageUseCase', () => {
  it('grava captura PENDING com a foto do store; repetida é ignorada', async () => {
    const s = await setup();
    expect(await s.msg()).toBe('captured');
    expect(await s.msg()).toBe('duplicate');
    expect(s.captured.items[0]).toMatchObject({ status: 'PENDING', sourceMediaUrl: 'https://api/media/1.jpg', imageUnavailable: false });
  });

  it('ignora: própria mensagem, fora de grupo, grupo não monitorado, texto sem link', async () => {
    const s = await setup();
    expect(await s.msg({ fromMe: true })).toBe('ignored');
    expect(await s.msg({ isGroup: false })).toBe('ignored');
    expect(await s.msg({ groupJid: 'outro' })).toBe('ignored');
    expect(await s.msg({ body: 'bom dia grupo' })).toBe('ignored');
    expect(s.captured.items).toHaveLength(0);
  });

  it('fora da janela: captura por padrão (acumula a fila); com "capturar fora do horário" desligado, não captura', async () => {
    // NOW = 12:00 em São Paulo; janela 14:00–20:00 deixa o agora de fora
    const window = { windowStartMinute: 840, windowEndMinute: 1200 };
    const a = await setup({ settings: window });
    expect(await a.msg()).toBe('captured');
    const b = await setup({ settings: { ...window, captureOutsideWindow: false } });
    expect(await b.msg()).toBe('outside_window');
    expect(b.captured.items).toHaveLength(0);
    const c = await setup({ settings: { ...window, captureOutsideWindow: false, windowStartMinute: 600 } });
    expect(await c.msg()).toBe('captured');
  });

  it('dia fora dos dias de postagem conta como fora do horário', async () => {
    // Domingo 12:00 em SP, dia inteiro só seg–sex
    const sunday = () => new Date('2026-11-01T15:00:00.000Z');
    const weekdays = [1, 2, 3, 4, 5];
    const a = await setup({ settings: { captureOutsideWindow: false, weekdays }, captureNow: sunday });
    expect(await a.msg()).toBe('outside_window');
    const b = await setup({ settings: { captureOutsideWindow: false, weekdays } });
    expect(await b.msg()).toBe('captured');
  });

  it('monitoramento desligado não captura', async () => {
    const s = await setup({ settings: { enabled: false } });
    expect(await s.msg()).toBe('ignored');
  });

  it('palavras-chave filtram', async () => {
    const s = await setup();
    s.monitors.monitored[0]!.keywords = ['geladeira'];
    expect(await s.msg()).toBe('ignored');
  });

  it('vídeo ou imagem fora do formato: só texto, marcado como imagem indisponível quando era foto', async () => {
    const s = await setup();
    await s.msg({ msgType: 'VIDEO', mimeType: 'video/mp4', externalMessageId: 'v' });
    await s.msg({ mimeType: 'image/gif', externalMessageId: 'g' });
    await s.msg({ mediaUrl: null, externalMessageId: 'n' });
    await s.msg({ mimeType: 'image/jpg', externalMessageId: 'j' });
    expect(s.captured.items.map((c) => [c.sourceMediaUrl, c.imageUnavailable])).toEqual([
      [null, false], [null, true], [null, true], ['https://api/media/1.jpg', false],
    ]);
  });
});

describe('ProcessPendingCapturedOffersUseCase', () => {
  it('troca o link pelo do tenant, tira o convite do concorrente, cupom com validade curta e enfileira', async () => {
    const s = await setup();
    await s.msg();
    expect(await s.process.execute()).toEqual({ processed: 1 });
    const q = s.queue.inputs[0]!;
    expect(q.text).toBe('🔥 Fone JBL por R$ 99\nhttps://www.amazon.com.br/dp/B0ABCDEFGH?tag=meu-20\nCupom: PROMO10');
    expect(q.text).not.toContain('concorrente');
    expect(q.destinations).toEqual([{ conversationId: 'c-g1', sessionId: SESSION }, { conversationId: 'c-g2', sessionId: SESSION }]);
    expect(q).toMatchObject({ imageUrl: 'https://api/media/1.jpg', coupon: 'PROMO10', title: '🔥 Fone JBL por R$ 99', startAt: NOW });
    expect(q.expiresAt).toEqual(new Date(NOW.getTime() + 60 * 60_000));
    expect(s.captured.items[0]).toMatchObject({ status: 'QUEUED', offerId: 'offer-9', marketplace: 'AMAZON', coupon: 'PROMO10' });
  });

  it('atraso e janela: captura às 12h com janela 14h–20h começa às 14h', async () => {
    const s = await setup({ settings: { windowStartMinute: 840, windowEndMinute: 1200, maxOfferAgeMinutes: 600, couponMaxAgeMinutes: 600 } });
    await s.msg();
    await s.process.execute();
    expect(s.queue.inputs[0]!.startAt).toEqual(new Date('2026-10-28T17:00:00.000Z'));
  });

  it('captura fora da janela acumula: a validade conta da abertura da janela, não da captura', async () => {
    // 12:00 em SP, janela 14:00–20:00, cupom com validade de 60 min → sai às 14:00 e vale até 15:00
    const s = await setup({ settings: { windowStartMinute: 840, windowEndMinute: 1200 } });
    await s.msg();
    await s.process.execute();
    expect(s.queue.inputs).toHaveLength(1);
    expect(s.queue.inputs[0]!.startAt).toEqual(new Date('2026-10-28T17:00:00.000Z'));
    expect(s.queue.inputs[0]!.expiresAt).toEqual(new Date('2026-10-28T18:00:00.000Z'));
  });

  it('dias da semana: captura no domingo com seg–sex vai para segunda na abertura; validade conta da captura', async () => {
    // Domingo 12:00 em SP, janela 14:00–20:00 seg–sex, cupom 60 min → segunda 14:00, vale até 15:00
    const sunday = () => new Date('2026-11-01T15:00:00.000Z');
    const s = await setup({ settings: { windowStartMinute: 840, windowEndMinute: 1200, weekdays: [1, 2, 3, 4, 5] }, captureNow: sunday });
    expect(await s.msg()).toBe('captured');
    await s.process.execute();
    const q = s.queue.inputs[0]!;
    expect(q.startAt).toEqual(new Date('2026-11-02T17:00:00.000Z'));
    expect(q.expiresAt).toEqual(new Date('2026-11-02T18:00:00.000Z'));
    // Encaixe dos envios seguintes também pula o fim de semana: sexta 20:30 → segunda 14:00
    expect(q.fitSlot!(new Date('2026-11-06T23:30:00.000Z'))).toEqual(new Date('2026-11-09T17:00:00.000Z'));
  });

  it('processamento atrasado não renova a validade: conta da captura, início é agora', async () => {
    // Capturada 12:00 (validade do cupom 60 min → 13:00); processada só às 12:40: sai agora, vence 13:00
    const late = new Date(NOW.getTime() + 40 * 60_000);
    const s = await setup({ processNow: () => late });
    await s.msg();
    await s.process.execute();
    expect(s.queue.inputs[0]!.startAt).toEqual(late);
    expect(s.queue.inputs[0]!.expiresAt).toEqual(new Date(NOW.getTime() + 60 * 60_000));
  });

  it('fila da sessão empurra para depois da validade: EXPIRED', async () => {
    const s = await setup();
    s.queue.result = () => ({ kind: 'expired', firstSendAt: new Date(NOW.getTime() + 7_200_000) });
    await s.msg();
    await s.process.execute();
    expect(s.captured.items[0]).toMatchObject({ status: 'SKIPPED', reason: 'EXPIRED' });
  });

  it('sem credencial: SKIPPED CREDENTIAL_MISSING; erro da API: FAILED LINK_RESOLVE_FAILED', async () => {
    const s = await setup();
    s.links.resolve = () => ({ kind: 'credential_missing', provider: 'SHOPEE' });
    await s.msg();
    await s.process.execute();
    expect(s.captured.items[0]).toMatchObject({ status: 'SKIPPED', reason: 'CREDENTIAL_MISSING', marketplace: 'SHOPEE' });
    s.links.resolve = () => ({ kind: 'failed', provider: 'SHOPEE', code: 'X' });
    await s.msg({ externalMessageId: 'm2' });
    await s.process.execute();
    expect(s.captured.items[1]).toMatchObject({ status: 'FAILED', reason: 'LINK_RESOLVE_FAILED' });
  });

  it('link do tenant com pontuação colada continua aceito pela rede de segurança', async () => {
    const s = await setup();
    await s.msg({ body: 'Fone (https://amzn.to/abc).' });
    await s.process.execute();
    expect(s.captured.items[0]).toMatchObject({ status: 'QUEUED' });
  });

  it('só links fora de marketplace: UNSUPPORTED_MARKETPLACE', async () => {
    const s = await setup();
    await s.msg({ body: 'Entrem: https://chat.whatsapp.com/XYZ' });
    await s.process.execute();
    expect(s.captured.items[0]).toMatchObject({ status: 'SKIPPED', reason: 'UNSUPPORTED_MARKETPLACE' });
  });

  it('sem grupos de disparo, ou monitoramento desligado depois da captura: SKIPPED', async () => {
    const s = await setup({ broadcast: [] });
    await s.msg();
    await s.process.execute();
    expect(s.captured.items[0]).toMatchObject({ status: 'SKIPPED', reason: 'NO_BROADCAST_GROUPS' });
    const t = await setup();
    await t.msg();
    t.monitors.configs[0]!.enabled = false;
    await t.process.execute();
    expect(t.captured.items[0]).toMatchObject({ status: 'SKIPPED', reason: 'MONITOR_DISABLED' });
  });

  it('plano rebaixado: envia só até o limite; marcar todos bloqueado pelo plano sai desligado', async () => {
    const s = await setup({ broadcast: ['g1', 'g2', 'g3'], settings: { mentionAll: true }, entitlements: { broadcast_groups: 2, mention_all_enabled: false } });
    await s.msg();
    await s.process.execute();
    expect(s.queue.inputs[0]!.destinations.map((d) => d.conversationId)).toEqual(['c-g1', 'c-g2']);
    expect(s.queue.inputs[0]).toMatchObject({ mentionAll: false });
  });

  it('copia o formato da imagem da configuração para a oferta', async () => {
    const s = await setup({ settings: { imageMode: 'LINK_PREVIEW' } });
    await s.msg();
    await s.process.execute();
    expect(s.queue.inputs[0]).toMatchObject({ imageMode: 'LINK_PREVIEW' });
  });

  it('erro inesperado vira FAILED INTERNAL_ERROR e não derruba o tick', async () => {
    const s = await setup();
    s.queue.result = () => { throw new TypeError('bug'); };
    await s.msg();
    await s.msg({ externalMessageId: 'm2' });
    expect(await s.process.execute()).toEqual({ processed: 2 });
    expect(s.captured.items.map((c) => c.reason)).toEqual(['INTERNAL_ERROR', 'INTERNAL_ERROR']);
  });
});

describe('ProcessPendingCapturedOffersUseCase — oferta montada e reescrita com IA', () => {
  const LINK_ONLY = 'https://amzn.to/abc';
  const TENANT_LINK = 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=meu-20';

  it('ORIGINAL com texto: não lê produto nem compõe (comportamento de sempre)', async () => {
    const s = await setup();
    await s.msg();
    await s.process.execute();
    expect(s.products.calls).toHaveLength(0);
    expect(s.texts.inputs).toHaveLength(0);
    expect(s.captured.items[0]).toMatchObject({ status: 'QUEUED', textSource: 'ORIGINAL', aiErrorCode: null });
  });

  it('captura só com link: monta pelo modelo com dados do produto e guarda a foto do produto', async () => {
    const s = await setup();
    await s.msg({ body: LINK_ONLY, msgType: 'TEXT', mediaUrl: null, mimeType: null });
    await s.process.execute();
    expect(s.products.calls).toEqual([{ provider: 'AMAZON', sourceUrl: 'https://www.amazon.com.br/dp/B0ABCDEFGH' }]);
    expect(s.texts.inputs[0]).toMatchObject({ audience: 'STANDARD', title: 'Fone JBL Tune 510BT', priceCents: 9900, originalPriceCents: 19900, affiliateUrl: TENANT_LINK, coupon: null });
    const q = s.queue.inputs[0]!;
    expect(q.text).toBe(`*Fone JBL Tune 510BT*\nDe R$ 199.00 por R$ 99.00\n${TENANT_LINK}`);
    expect(q.title).toBe('*Fone JBL Tune 510BT*');
    expect(q.imageUrl).toBe('https://api/media/stored-1.jpg');
    expect(s.images.stored).toEqual(['https://m.media-amazon.com/images/I/fone.jpg']);
    expect(s.captured.items[0]).toMatchObject({ status: 'QUEUED', textSource: 'TEMPLATE', finalText: q.text });
  });

  it('só link com enrichLinkOnly desligado: sai só o link do tenant, ORIGINAL, com a foto do produto', async () => {
    const s = await setup({ settings: { enrichLinkOnly: false } });
    await s.msg({ body: LINK_ONLY, msgType: 'TEXT', mediaUrl: null, mimeType: null });
    await s.process.execute();
    expect(s.texts.inputs).toHaveLength(0);
    expect(s.queue.inputs[0]!.text).toBe(TENANT_LINK);
    expect(s.queue.inputs[0]!.imageUrl).toBe('https://api/media/stored-1.jpg');
    expect(s.captured.items[0]).toMatchObject({ textSource: 'ORIGINAL' });
  });

  it('ORIGINAL com texto e sem foto na mensagem (link com prévia): texto original + foto do produto', async () => {
    const s = await setup();
    await s.msg({ msgType: 'TEXT', mediaUrl: null, mimeType: null });
    await s.process.execute();
    expect(s.texts.inputs).toHaveLength(0);
    expect(s.queue.inputs[0]!.text).toContain('Fone JBL por R$ 99');
    expect(s.queue.inputs[0]!.imageUrl).toBe('https://api/media/stored-1.jpg');
    expect(s.images.stored).toEqual(['https://m.media-amazon.com/images/I/fone.jpg']);
    expect(s.captured.items[0]).toMatchObject({ status: 'QUEUED', textSource: 'ORIGINAL' });
  });

  it('ORIGINAL sem foto e link já trouxe o produto (vitrine social ML): foto da vitrine, sem reler a página', async () => {
    const s = await setup();
    s.links.resolve = () => ({
      kind: 'ok', provider: 'MERCADO_LIVRE', sourceUrl: 'https://produto.mercadolivre.com.br/MLB-1010954920', affiliateUrl: 'https://meli.la/meu',
      product: { title: 'Kit 6 Cuecas', priceCents: 12519, originalPriceCents: 28863, imageUrl: 'https://http2.mlstatic.com/D_NQ_NP_2X_1-F.webp' },
    });
    await s.msg({ msgType: 'TEXT', mediaUrl: null, mimeType: null });
    await s.process.execute();
    expect(s.products.calls).toHaveLength(0);
    expect(s.images.stored).toEqual(['https://http2.mlstatic.com/D_NQ_NP_2X_1-F.webp']);
    expect(s.queue.inputs[0]!.imageUrl).toBe('https://api/media/stored-1.jpg');
    expect(s.captured.items[0]).toMatchObject({ status: 'QUEUED', textSource: 'ORIGINAL' });
  });

  it('modelo com produto vindo do link: compõe com os dados da vitrine, sem reler a página', async () => {
    const s = await setup({ settings: { textMode: 'TEMPLATE' } });
    s.links.resolve = () => ({
      kind: 'ok', provider: 'MERCADO_LIVRE', sourceUrl: 'https://produto.mercadolivre.com.br/MLB-1', affiliateUrl: 'https://meli.la/meu',
      product: { title: 'Kit 6 Cuecas', priceCents: 12519, originalPriceCents: 28863, imageUrl: null },
    });
    await s.msg({ msgType: 'TEXT', mediaUrl: null, mimeType: null });
    await s.process.execute();
    expect(s.products.calls).toHaveLength(0);
    expect(s.texts.inputs[0]).toMatchObject({ title: 'Kit 6 Cuecas', priceCents: 12519 });
    expect(s.captured.items[0]).toMatchObject({ status: 'QUEUED', textSource: 'TEMPLATE' });
  });

  it('ORIGINAL sem foto e leitura do produto falha: segue só com texto', async () => {
    const s = await setup();
    s.products.read = async () => { throw new Error('boom'); };
    await s.msg({ msgType: 'TEXT', mediaUrl: null, mimeType: null });
    await s.process.execute();
    expect(s.queue.inputs[0]!.imageUrl).toBeNull();
    expect(s.captured.items[0]).toMatchObject({ status: 'QUEUED', textSource: 'ORIGINAL' });
  });

  it('modo AI com público: compõe pela IA, textSource AI; foto da mensagem tem prioridade', async () => {
    const s = await setup({ settings: { textMode: 'AI', audience: 'MOMS' } });
    await s.msg();
    await s.process.execute();
    expect(s.texts.inputs[0]).toMatchObject({ audience: 'MOMS', coupon: 'PROMO10' });
    expect(s.queue.inputs[0]!.text).toBe(`✨ Texto da IA para MOMS: Fone JBL Tune 510BT\n${TENANT_LINK}`);
    expect(s.queue.inputs[0]!.imageUrl).toBe('https://api/media/1.jpg');
    expect(s.images.stored).toHaveLength(0);
    expect(s.captured.items[0]).toMatchObject({ textSource: 'AI', aiErrorCode: null });
  });

  it('IA indisponível: cai no modelo, TEMPLATE com aiErrorCode', async () => {
    const s = await setup({ settings: { textMode: 'AI', audience: 'PET' } });
    s.texts.result = (i) => ({ text: `*${i.title}*\n${i.affiliateUrl}`, aiFallback: true, aiErrorCode: 'AI_NOT_CONFIGURED' });
    await s.msg();
    await s.process.execute();
    expect(s.captured.items[0]).toMatchObject({ status: 'QUEUED', textSource: 'TEMPLATE', aiErrorCode: 'AI_NOT_CONFIGURED' });
  });

  it('modo AI com público STANDARD equivale ao modelo', async () => {
    const s = await setup({ settings: { textMode: 'AI', audience: 'STANDARD' } });
    await s.msg();
    await s.process.execute();
    expect(s.texts.inputs[0]!.audience).toBe('STANDARD');
    expect(s.captured.items[0]).toMatchObject({ textSource: 'TEMPLATE' });
  });

  it('sem dados do produto: texto original, captura segue QUEUED', async () => {
    const s = await setup({ settings: { textMode: 'TEMPLATE' } });
    s.products.data = null;
    await s.msg();
    await s.process.execute();
    expect(s.texts.inputs).toHaveLength(0);
    expect(s.queue.inputs[0]!.text).toContain('Fone JBL por R$ 99');
    expect(s.captured.items[0]).toMatchObject({ status: 'QUEUED', textSource: 'ORIGINAL' });
  });

  it('texto composto com link estranho é descartado: volta ao original', async () => {
    const s = await setup({ settings: { textMode: 'AI', audience: 'MEN' } });
    s.texts.result = (i) => ({ text: `Compre em https://loja-do-concorrente.com/x\n${i.affiliateUrl}`, aiFallback: false });
    await s.msg();
    await s.process.execute();
    expect(s.queue.inputs[0]!.text).not.toContain('concorrente');
    expect(s.captured.items[0]).toMatchObject({ status: 'QUEUED', textSource: 'ORIGINAL' });
  });
});

describe('ProcessPendingCapturedOffersUseCase — sessão cruzada', () => {
  it('com cross_session_dispatch: destino de outra sessão vai para a fila na faixa dela', async () => {
    const s = await setup({ entitlements: { cross_session_dispatch: true } });
    const cfg = (await s.monitors.findConfig(TENANT, SESSION))!;
    await s.monitors.replaceBroadcast(TENANT, SESSION, cfg.id, [
      { conversationId: 'c-mine', groupJid: 'mine', sessionId: SESSION },
      { conversationId: 'c-other', groupJid: 'other', sessionId: 'session-2' },
    ]);
    await s.msg();
    await s.process.execute();
    expect(s.queue.inputs[0]!.destinations).toEqual([{ conversationId: 'c-mine', sessionId: SESSION }, { conversationId: 'c-other', sessionId: 'session-2' }]);
  });

  it('plano rebaixado (sem a feature): só os grupos da própria sessão recebem', async () => {
    const s = await setup();
    const cfg = (await s.monitors.findConfig(TENANT, SESSION))!;
    await s.monitors.replaceBroadcast(TENANT, SESSION, cfg.id, [
      { conversationId: 'c-other', groupJid: 'other', sessionId: 'session-2' },
      { conversationId: 'c-mine', groupJid: 'mine', sessionId: SESSION },
    ]);
    await s.msg();
    await s.process.execute();
    expect(s.queue.inputs[0]!.destinations).toEqual([{ conversationId: 'c-mine', sessionId: SESSION }]);
  });
});

describe('ProcessPendingCapturedOffersUseCase — limites por canal', () => {
  async function mixed(entitlements: Record<string, unknown>) {
    const s = await setup({ entitlements });
    s.monitors.sessions.add(`${TENANT}:tg-1`).add(`${TENANT}:tg-2`);
    Object.assign(s.monitors.engines, { 'tg-1': 'telegram', 'tg-2': 'telegram' });
    const cfg = (await s.monitors.findConfig(TENANT, SESSION))!;
    await s.monitors.replaceBroadcast(TENANT, SESSION, cfg.id, [
      { conversationId: 'c-t1', groupJid: '-1', sessionId: 'tg-1' },
      { conversationId: 'c-w1', groupJid: 'w1', sessionId: SESSION },
      { conversationId: 'c-t2', groupJid: '-2', sessionId: 'tg-2' },
      { conversationId: 'c-w2', groupJid: 'w2', sessionId: SESSION },
      { conversationId: 'c-t3', groupJid: '-3', sessionId: 'tg-1' },
    ]);
    await s.msg();
    await s.process.execute();
    return s.queue.inputs[0]?.destinations.map((d) => d.conversationId);
  }

  it('corte por canal: cada canal até o próprio limite, na ordem da lista', async () => {
    expect(await mixed({ cross_session_dispatch: true, broadcast_groups: 1, telegram_broadcast_groups: 2 })).toEqual(['c-t1', 'c-w1', 'c-t2']);
  });

  it('sem cross_session_dispatch: canal diferente segue; no Telegram, só a 1ª sessão', async () => {
    expect(await mixed({})).toEqual(['c-t1', 'c-w1', 'c-w2', 'c-t3']);
  });

  it('limite 0 no Telegram (Lite): só o WhatsApp recebe', async () => {
    expect(await mixed({ cross_session_dispatch: true, telegram_broadcast_groups: 0 })).toEqual(['c-w1', 'c-w2']);
  });
});

describe('ProcessPendingCapturedOffersUseCase — credencial recusada', () => {
  const SINCE = new Date('2026-10-28T10:00:00.000Z');

  it('link recusado → SKIPPED/CREDENTIAL_REJECTED com a loja; nada vai para a fila', async () => {
    const s = await setup();
    s.links.resolve = () => ({ kind: 'credential_rejected', provider: 'AMAZON', since: SINCE });
    await s.msg();
    await s.process.execute();
    expect(s.captured.items[0]).toMatchObject({ status: 'SKIPPED', reason: 'CREDENTIAL_REJECTED', marketplace: 'AMAZON' });
    expect(s.queue.inputs).toHaveLength(0);
  });

  it('dois links, um recusado e um ok: SKIPPED/CREDENTIAL_REJECTED (não envia texto pela metade)', async () => {
    const s = await setup();
    s.links.resolve = (href) => (href.includes('amzn.to')
      ? { kind: 'ok', provider: 'AMAZON', sourceUrl: 'https://www.amazon.com.br/dp/B0ABCDEFGH', affiliateUrl: 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=meu-20' }
      : href.includes('shopee') ? { kind: 'credential_rejected', provider: 'SHOPEE', since: SINCE } : { kind: 'unsupported' });
    await s.msg({ body: 'Oferta\nhttps://amzn.to/abc\nhttps://shopee.com.br/product/1/2' });
    await s.process.execute();
    expect(s.captured.items[0]).toMatchObject({ status: 'SKIPPED', reason: 'CREDENTIAL_REJECTED', marketplace: 'SHOPEE' });
    expect(s.queue.inputs).toHaveLength(0);
  });
});

describe('ProcessPendingCapturedOffersUseCase — janela em todos os envios', () => {
  it('passa o encaixe na janela para a fila: horário fora da janela vai para o próximo início', async () => {
    const s = await setup({ settings: { windowStartMinute: 840, windowEndMinute: 1200, maxOfferAgeMinutes: 1440, couponMaxAgeMinutes: 1440 } });
    await s.msg();
    await s.process.execute();
    const fit = s.queue.inputs[0]!.fitSlot!;
    // 19:59 em São Paulo fica; 20:01 vai para 14:00 do dia seguinte
    expect(fit(new Date('2026-10-28T22:59:00.000Z'))).toEqual(new Date('2026-10-28T22:59:00.000Z'));
    expect(fit(new Date('2026-10-28T23:01:00.000Z'))).toEqual(new Date('2026-10-29T17:00:00.000Z'));
  });
});

describe('ProcessPendingCapturedOffersUseCase — parada cooperativa e observação', () => {
  afterEach(() => vi.restoreAllMocks());

  /** Use case sobre os mesmos dublês do setup, com relógio e `now` controláveis. */
  function withClock(s: Awaited<ReturnType<typeof setup>>, clock: () => number, now: () => Date = () => NOW) {
    return new ProcessPendingCapturedOffersUseCase({
      captured: s.captured, monitors: s.monitors, links: s.links, queue: s.queue, entitlements: new FakeEntitlements(),
      products: s.products, texts: s.texts, images: s.images, now, clock,
    });
  }
  const capture = async (s: Awaited<ReturnType<typeof setup>>, n: number) => {
    for (let i = 0; i < n; i++) await s.msg({ externalMessageId: `m${i}` });
  };

  it('sem contexto: até três por rodada (comportamento de sempre)', async () => {
    const s = await setup();
    await capture(s, 4);
    expect(await s.process.execute()).toEqual({ processed: 3 });
    expect(s.captured.items.map((c) => c.status)).toEqual(['QUEUED', 'QUEUED', 'QUEUED', 'PENDING']);
  });

  it('sinal já abortado: nenhum claim nem enqueue', async () => {
    const s = await setup();
    await capture(s, 2);
    const claim = vi.spyOn(s.captured, 'claimPending');
    expect(await s.process.execute({ signal: AbortSignal.abort() })).toEqual({ processed: 0 });
    expect(claim).not.toHaveBeenCalled();
    expect(s.queue.inputs).toHaveLength(0);
  });

  it('parada durante o claim: item fica PROCESSING recuperável, sem FAILED/INTERNAL_ERROR', async () => {
    const s = await setup();
    await capture(s, 2);
    const ac = new AbortController();
    const original = s.captured.claimPending.bind(s.captured);
    vi.spyOn(s.captured, 'claimPending').mockImplementation(async (...a) => {
      const r = await original(...a);
      ac.abort();
      return r;
    });
    await s.process.execute({ signal: ac.signal });
    expect(s.queue.inputs).toHaveLength(0);
    expect(s.captured.items.map((c) => [c.status, c.reason])).toEqual([['PROCESSING', null], ['PENDING', null]]);
  });

  it('parada antes do enqueue: não cria oferta; reprocessada depois pelo stale com a mesma sourceKey e validade original', async () => {
    const s = await setup();
    await capture(s, 1);
    const ac = new AbortController();
    s.links.resolve = (href) => {
      ac.abort();
      return href.includes('amzn.to')
        ? { kind: 'ok', provider: 'AMAZON', sourceUrl: 'https://www.amazon.com.br/dp/B0ABCDEFGH', affiliateUrl: 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=meu-20' }
        : { kind: 'unsupported' };
    };
    await s.process.execute({ signal: ac.signal });
    expect(s.queue.inputs).toHaveLength(0);
    expect(s.captured.items[0]).toMatchObject({ status: 'PROCESSING', reason: null });

    // Stale devolve (simulado): retoma 30 min depois sem renovar a validade da captura
    Object.assign(s.captured.items[0]!, { status: 'PENDING', claimToken: null });
    const later = withClock(s, Date.now, () => new Date(NOW.getTime() + 30 * 60_000));
    expect(await later.execute()).toEqual({ processed: 1 });
    expect(s.queue.inputs).toHaveLength(1);
    expect(s.queue.inputs[0]).toMatchObject({ sourceKey: `captured:${s.captured.items[0]!.id}` });
    expect(s.queue.inputs[0]!.expiresAt).toEqual(new Date(NOW.getTime() + 60 * 60_000));
    expect(s.captured.items[0]!.status).toBe('QUEUED');
  });

  it('parada durante o enqueue: o enqueue termina e markQueued ainda acontece; nada novo depois', async () => {
    const s = await setup();
    await capture(s, 2);
    const ac = new AbortController();
    const base = s.queue.result;
    s.queue.result = (i) => {
      ac.abort();
      return base(i);
    };
    expect(await s.process.execute({ signal: ac.signal })).toEqual({ processed: 1 });
    expect(s.queue.inputs).toHaveLength(1);
    expect(s.captured.items.map((c) => c.status)).toEqual(['QUEUED', 'PENDING']);
  });

  it('orçamento entre itens: estourado, não começa outra captura; o 1º item sempre roda', async () => {
    const s = await setup();
    await capture(s, 3);
    let t = 0;
    const clock = () => t;
    s.links.resolve = (href) => {
      t += CAPTURE_TICK_BUDGET_MS; // cada captura "gasta" o orçamento inteiro
      return href.includes('amzn.to')
        ? { kind: 'ok', provider: 'AMAZON', sourceUrl: 'https://www.amazon.com.br/dp/B0ABCDEFGH', affiliateUrl: 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=meu-20' }
        : { kind: 'unsupported' };
    };
    expect(await withClock(s, clock).execute()).toEqual({ processed: 1 });
  });

  it('log por item: idade e duração pelo relógio injetado, sem texto, link nem cupom', async () => {
    const s = await setup();
    await capture(s, 1);
    const info = vi.spyOn(logger, 'info');
    let t = 1_000;
    const uc = withClock(s, () => (t += 250), () => new Date(NOW.getTime() + 90_000));
    await uc.execute();
    const call = info.mock.calls.find((c) => c[1] === 'captured offer observed');
    expect(call?.[0]).toMatchObject({ status: 'QUEUED', reason: null, captureAgeMs: 90_000, tenantId: TENANT, sessionId: SESSION });
    expect((call?.[0] as { durationMs: number }).durationMs).toBeGreaterThan(0);
    const dump = JSON.stringify(info.mock.calls);
    for (const secret of ['http', 'PROMO10', 'Fone', 'concorrente', 'amazon']) expect(dump).not.toContain(secret);
  });

  it('log de falha também só leva o código', async () => {
    const s = await setup();
    s.links.resolve = () => ({ kind: 'credential_missing', provider: 'AMAZON' });
    await capture(s, 1);
    const info = vi.spyOn(logger, 'info');
    await s.process.execute();
    const call = info.mock.calls.find((c) => c[1] === 'captured offer observed');
    expect(call?.[0]).toMatchObject({ status: 'SKIPPED', reason: 'CREDENTIAL_MISSING' });
  });
});
