import { describe, expect, it } from 'vitest';
import { ProcessPendingCapturedOffersUseCase } from './ProcessPendingCapturedOffersUseCase';
import { RegisterCapturedMessageUseCase } from './RegisterCapturedMessageUseCase';
import { DEFAULT_MONITOR_SETTINGS } from '../../domain/services/monitorSettings';
import {
  FakeEntitlements, FakeLinkBuilder, FakeOfferQueue, InMemoryCapturedOfferRepository, InMemoryGroupMonitorRepository, NOW, SESSION, TENANT,
} from './monitorTestFakes';

const TEXT = '🔥 Fone JBL por R$ 99\nhttps://amzn.to/abc?tag=concorrente-20\nCupom: PROMO10\n👉 Grupo: https://chat.whatsapp.com/XYZ';

async function setup(opts: { settings?: Partial<typeof DEFAULT_MONITOR_SETTINGS>; broadcast?: string[]; entitlements?: Record<string, unknown> } = {}) {
  const monitors = new InMemoryGroupMonitorRepository();
  const captured = new InMemoryCapturedOfferRepository();
  const links = new FakeLinkBuilder();
  const queue = new FakeOfferQueue();
  const cfg = await monitors.saveSettings(TENANT, SESSION, { ...DEFAULT_MONITOR_SETTINGS, enabled: true, ...opts.settings });
  await monitors.replaceMonitored(TENANT, SESSION, cfg.id, [{ conversationId: 'c-src', groupJid: '120363-src', keywords: [] }]);
  await monitors.replaceBroadcast(TENANT, SESSION, cfg.id, (opts.broadcast ?? ['g1', 'g2']).map((j) => ({ conversationId: `c-${j}`, groupJid: j })));
  const register = new RegisterCapturedMessageUseCase({ monitors, captured, now: () => NOW });
  const process = new ProcessPendingCapturedOffersUseCase({
    captured, monitors, links, queue, entitlements: new FakeEntitlements(opts.entitlements), now: () => NOW,
  });
  const msg = (o = {}) => register.execute({
    tenantId: TENANT, sessionId: SESSION, isGroup: true, fromMe: false, groupJid: '120363-src', externalMessageId: 'm1',
    body: TEXT, msgType: 'IMAGE', mediaUrl: 'https://api/media/1.jpg', mimeType: 'image/jpeg', ...o,
  });
  return { monitors, captured, links, queue, register, process, msg };
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
    expect(q).toMatchObject({ conversationIds: ['c-g1', 'c-g2'], imageUrl: 'https://api/media/1.jpg', coupon: 'PROMO10', title: '🔥 Fone JBL por R$ 99', startAt: NOW });
    expect(q.expiresAt).toEqual(new Date(NOW.getTime() + 60 * 60_000));
    expect(s.captured.items[0]).toMatchObject({ status: 'QUEUED', offerId: 'offer-9', marketplace: 'AMAZON', coupon: 'PROMO10' });
  });

  it('atraso e janela: captura às 12h com janela 14h–20h começa às 14h', async () => {
    const s = await setup({ settings: { windowStartMinute: 840, windowEndMinute: 1200, maxOfferAgeMinutes: 600, couponMaxAgeMinutes: 600 } });
    await s.msg();
    await s.process.execute();
    expect(s.queue.inputs[0]!.startAt).toEqual(new Date('2026-10-28T17:00:00.000Z'));
  });

  it('cupom venceria antes da janela abrir: descarta (EXPIRED) sem enfileirar', async () => {
    const s = await setup({ settings: { windowStartMinute: 840, windowEndMinute: 1200 } });
    await s.msg();
    await s.process.execute();
    expect(s.queue.inputs).toHaveLength(0);
    expect(s.captured.items[0]).toMatchObject({ status: 'SKIPPED', reason: 'EXPIRED' });
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
    expect(s.queue.inputs[0]).toMatchObject({ conversationIds: ['c-g1', 'c-g2'], mentionAll: false });
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
