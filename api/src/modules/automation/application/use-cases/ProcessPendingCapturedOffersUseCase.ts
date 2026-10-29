import type { IEntitlementReader } from '../../../tenants/domain/contracts/IEntitlementReader';
import type { CapturedOfferResolution, ICapturedOfferRepository } from '../../domain/contracts/ICapturedOfferRepository';
import type { IGroupMonitorRepository } from '../../domain/contracts/IGroupMonitorRepository';
import type {
  IMonitorImageStore, IMonitorProductReader, IMonitorTextComposer, IOfferQueue, ITenantLinkBuilder, TenantLinkResult,
} from '../../domain/contracts/IMonitorPorts';
import type { GroupMonitorConfig, MonitorTextMode } from '../../domain/entities/GroupMonitor';
import type { CapturedOffer } from '../../domain/entities/CapturedOffer';
import { captureExpiresAt } from '../../domain/services/monitorSettings';
import { detectCoupon, extractUrls, hasTextBeyondLinks, rewriteOfferLinks } from '../../domain/services/offerMessageText';
import { resolveStartWithinWindow } from '../../domain/services/operatingWindow';
import { logger } from '../../../../shared/logger/logger';
import { BROADCAST_GROUPS, CROSS_SESSION_DISPATCH, MENTION_ALL_ENABLED } from './GroupMonitorConfigUseCases';

/** Capturas por tick (cada uma pode ir à rede: expandir link, API do marketplace). */
export const CAPTURE_BATCH_SIZE = 3;
/** Não começa outra captura depois disso no mesmo tick: o envio de ofertas divide o worker. */
export const CAPTURE_TICK_BUDGET_MS = 10_000;
/** PROCESSING sem resultado há mais que isso = worker caiu no meio; volta a ser reivindicada. */
export const CAPTURE_STALE_MS = 5 * 60_000;
/** Mensagem com mais links que isso é lista/catálogo, não oferta: não vai para a fila. */
export const CAPTURE_MAX_LINKS = 8;
/** Tempo máximo resolvendo links de UMA captura (cada link pode ir à rede); estourou = falha recuperável. */
export const CAPTURE_LINKS_BUDGET_MS = 25_000;
const TITLE_MAX = 120;

export interface ProcessPendingCapturedOffersDeps {
  captured: ICapturedOfferRepository;
  monitors: IGroupMonitorRepository;
  links: ITenantLinkBuilder;
  queue: IOfferQueue;
  entitlements: IEntitlementReader;
  products: IMonitorProductReader;
  texts: IMonitorTextComposer;
  images: IMonitorImageStore;
  now?: () => Date;
  clock?: () => number;
}

type Outcome =
  | { status: 'QUEUED'; data: CapturedOfferResolution & { offerId: string } }
  | { status: 'SKIPPED' | 'FAILED'; reason: Parameters<ICapturedOfferRepository['markSkipped']>[2]; data?: Partial<CapturedOfferResolution> };

/**
 * Um tick do processamento de capturas (roda no tick do worker de envio). Para cada captura:
 * link do tenant para cada link de produto (o resto é removido), cupom e validade, início dentro
 * da janela de operação, e entrada na fila de envio da sessão. Oferta/cupom que venceria antes
 * de sair é descartada (EXPIRED). Ver docs/monitoramento-grupos.md §3.
 */
export class ProcessPendingCapturedOffersUseCase {
  constructor(private readonly deps: ProcessPendingCapturedOffersDeps) {}

  async execute(): Promise<{ processed: number }> {
    const now = (this.deps.now ?? (() => new Date()))();
    const clock = this.deps.clock ?? Date.now;
    const started = clock();
    let processed = 0;
    // Uma por vez enquanto houver orçamento: nada fica reivindicado sem ser processado
    while (processed < CAPTURE_BATCH_SIZE && (processed === 0 || clock() - started < CAPTURE_TICK_BUDGET_MS)) {
      const [c] = await this.deps.captured.claimPending(1, new Date(now.getTime() - CAPTURE_STALE_MS));
      if (!c) break;
      processed++;
      let outcome: Outcome;
      try {
        outcome = await this.resolve(c, (this.deps.now ?? (() => new Date()))());
      } catch (err) {
        logger.error({ err: (err as Error)?.name, capturedOfferId: c.id, tenantId: c.tenantId }, 'captured offer processing failed');
        outcome = { status: 'FAILED', reason: 'INTERNAL_ERROR' };
      }
      await this.mark(c, outcome);
    }
    return { processed };
  }

  private async mark(c: CapturedOffer, o: Outcome): Promise<void> {
    const token = c.claimToken!;
    const { captured } = this.deps;
    try {
      const ok = o.status === 'QUEUED'
        ? await captured.markQueued(c.id, token, o.data)
        : o.status === 'SKIPPED'
          ? await captured.markSkipped(c.id, token, o.reason, o.data)
          : await captured.markFailed(c.id, token, o.reason, o.data);
      if (!ok) logger.warn({ capturedOfferId: c.id, tenantId: c.tenantId }, 'captured offer no longer owned');
    } catch (err) {
      logger.error({ err: (err as Error)?.name, capturedOfferId: c.id, tenantId: c.tenantId }, 'captured offer mark failed');
    }
  }

  private buildText(
    c: CapturedOffer, config: GroupMonitorConfig, link: Extract<TenantLinkResult, { kind: 'ok' }>, coupon: string | null, originalText: string, tenantLinks: ReadonlySet<string>,
  ): Promise<BuiltText> {
    return buildMonitorText(this.deps, c, config, link, coupon, originalText, tenantLinks);
  }

  private async resolve(c: CapturedOffer, now: Date): Promise<Outcome> {
    const { monitors, links, queue, entitlements } = this.deps;
    const config = await monitors.findConfig(c.tenantId, c.sessionId);
    if (!config?.enabled) return { status: 'SKIPPED', reason: 'MONITOR_DISABLED' };
    let targets = await monitors.listBroadcast(c.tenantId, c.sessionId);
    // Plano rebaixado depois de salvar: sem sessão cruzada, só os grupos da própria sessão
    if (targets.some((t) => t.sessionId !== c.sessionId) && (await entitlements.getBoolean(c.tenantId, CROSS_SESSION_DISPATCH)) !== true) {
      targets = targets.filter((t) => t.sessionId === c.sessionId);
    }
    // Plano rebaixado depois de salvar: envia só até o limite atual
    const limit = await entitlements.getNumber(c.tenantId, BROADCAST_GROUPS);
    if (limit !== null) targets = targets.slice(0, Math.max(0, limit));
    if (targets.length === 0) return { status: 'SKIPPED', reason: 'NO_BROADCAST_GROUPS' };

    const urls = extractUrls(c.sourceText);
    if (urls.length > CAPTURE_MAX_LINKS) return { status: 'SKIPPED', reason: 'UNSUPPORTED_MARKETPLACE' };
    const replacements = new Map<string, string | null>();
    let first: Extract<TenantLinkResult, { kind: 'ok' }> | null = null;
    const clock = this.deps.clock ?? Date.now;
    const linksStarted = clock();
    for (const u of urls) {
      if (clock() - linksStarted > CAPTURE_LINKS_BUDGET_MS) return { status: 'FAILED', reason: 'LINK_RESOLVE_FAILED' };
      const r = await links.build(c.tenantId, u.href);
      // O último link também conta: estourou no meio, não segue para os próximos
      if (clock() - linksStarted > CAPTURE_LINKS_BUDGET_MS) return { status: 'FAILED', reason: 'LINK_RESOLVE_FAILED' };
      if (r.kind === 'failed') {
        logger.warn({ capturedOfferId: c.id, tenantId: c.tenantId, marketplace: r.provider, code: r.code }, 'captured offer link not built');
        return { status: 'FAILED', reason: 'LINK_RESOLVE_FAILED', data: { marketplace: r.provider } };
      }
      // Loja pausada (credencial recusada): não envia texto pela metade nem tenta os outros links
      if (r.kind === 'credential_rejected') return { status: 'SKIPPED', reason: 'CREDENTIAL_REJECTED', data: { marketplace: r.provider } };
      if (r.kind === 'credential_missing') return { status: 'SKIPPED', reason: 'CREDENTIAL_MISSING', data: { marketplace: r.provider } };
      replacements.set(u.href, r.kind === 'ok' ? r.affiliateUrl : null);
      if (r.kind === 'ok') first ??= r;
    }
    if (!first) return { status: 'SKIPPED', reason: urls.length ? 'UNSUPPORTED_MARKETPLACE' : 'NO_LINK' };

    const finalText = rewriteOfferLinks(c.sourceText, replacements);
    // Rede de segurança: nenhum link que não seja do tenant pode sobrar no texto enviado
    const tenantLinks = new Set([...replacements.values()].filter((v): v is string => v !== null));
    if (extractUrls(finalText).some((u) => !tenantLinks.has(u.raw) && !tenantLinks.has(u.href))) {
      return { status: 'FAILED', reason: 'LINK_RESOLVE_FAILED', data: { marketplace: first.provider } };
    }
    const coupon = detectCoupon(c.sourceText);
    // Validade conta do início previsto do envio: captura fora da janela acumula e sai quando ela abrir
    const earliest = new Date(Math.max(now.getTime(), c.capturedAt.getTime() + config.startDelaySeconds * 1000));
    const startAt = resolveStartWithinWindow(earliest, { startMinute: config.windowStartMinute, endMinute: config.windowEndMinute });
    const expiresAt = captureExpiresAt(startAt, coupon !== null, config);
    const built = await this.buildText(c, config, first, coupon, finalText, tenantLinks);
    const base: CapturedOfferResolution = {
      marketplace: first.provider, sourceUrl: first.sourceUrl, affiliateUrl: first.affiliateUrl, coupon,
      finalText: built.text, textSource: built.textSource, aiErrorCode: built.aiErrorCode, expiresAt, startsAt: null,
    };

    const mentionAll = config.mentionAll && (await entitlements.getBoolean(c.tenantId, MENTION_ALL_ENABLED)) !== false;
    const res = await queue.enqueue({
      tenantId: c.tenantId,
      destinations: targets.map((t) => ({ conversationId: t.conversationId, sessionId: t.sessionId })),
      provider: first.provider,
      sourceUrl: first.sourceUrl,
      affiliateUrl: first.affiliateUrl,
      title: titleOf(built.text),
      text: built.text,
      imageUrl: built.imageUrl,
      coupon,
      mentionAll,
      simulateTyping: config.simulateTyping,
      typingSeconds: config.typingSeconds,
      startAt,
      expiresAt,
      intervalMinSeconds: config.intervalMinSeconds,
      intervalMaxSeconds: config.intervalMaxSeconds,
      // Queda entre criar a oferta e marcar QUEUED: o reprocessamento reaproveita a oferta
      sourceKey: `captured:${c.id}`,
      // Todos os envios dentro da janela (o fim empurra para o próximo início); o claim garante no envio
      fitSlot: (at) => resolveStartWithinWindow(at, { startMinute: config.windowStartMinute, endMinute: config.windowEndMinute }),
      monitorConfigId: config.id,
    });
    if (res.kind === 'expired') return { status: 'SKIPPED', reason: 'EXPIRED', data: { ...base, startsAt: res.firstSendAt } };
    return { status: 'QUEUED', data: { ...base, startsAt: res.firstSendAt, offerId: res.offerId } };
  }
}

interface BuiltText {
  text: string;
  textSource: MonitorTextMode;
  aiErrorCode: string | null;
  imageUrl: string | null;
}

/**
 * Oferta montada / reescrita (docs/monitoramento-grupos.md §2.4). `ORIGINAL` = texto do grupo com
 * links trocados (como sempre). `TEMPLATE`/`AI`, ou captura só com link(s) com `enrichLinkOnly`:
 * lê o produto e compõe pelo mesmo compositor do gerador (a IA só vê JSON de dados, nunca o texto
 * do concorrente). Degrada em cascata: IA falha → modelo; sem dados → original. Foto: da mensagem,
 * senão a do produto no store. Nunca bloqueia a captura.
 */
async function buildMonitorText(
  deps: Pick<ProcessPendingCapturedOffersDeps, 'products' | 'texts' | 'images'>,
  c: CapturedOffer,
  config: GroupMonitorConfig,
  link: Extract<TenantLinkResult, { kind: 'ok' }>,
  coupon: string | null,
  originalText: string,
  tenantLinks: ReadonlySet<string>,
): Promise<BuiltText> {
  const original: BuiltText = { text: originalText, textSource: 'ORIGINAL', aiErrorCode: null, imageUrl: c.sourceMediaUrl };
  const linkOnly = !hasTextBeyondLinks(c.sourceText);
  const wantsProduct = config.textMode !== 'ORIGINAL' || (config.enrichLinkOnly && linkOnly);
  if (!wantsProduct) return original;

  const product = await deps.products.read(c.tenantId, link.provider, link.sourceUrl);
  if (!product || (!product.title && product.priceCents == null)) {
    logger.info({ capturedOfferId: c.id, tenantId: c.tenantId, marketplace: link.provider }, 'captured offer product data unavailable');
    return original;
  }
  const audience = config.textMode === 'AI' ? config.audience : 'STANDARD';
  const composed = await deps.texts.compose({
    tenantId: c.tenantId, audience, title: product.title, priceCents: product.priceCents,
    originalPriceCents: product.originalPriceCents, coupon, affiliateUrl: link.affiliateUrl,
  });
  // Rede de segurança também sobre o texto composto: só o link do tenant pode sair
  if (extractUrls(composed.text).some((u) => !tenantLinks.has(u.raw) && !tenantLinks.has(u.href))) {
    logger.warn({ capturedOfferId: c.id, tenantId: c.tenantId }, 'captured offer composed text had foreign link');
    return original;
  }
  const imageUrl = c.sourceMediaUrl ?? (product.imageUrl ? await deps.images.store(product.imageUrl) : null);
  const usedAi = audience !== 'STANDARD' && !composed.aiFallback;
  return { text: composed.text, textSource: usedAi ? 'AI' : 'TEMPLATE', aiErrorCode: composed.aiErrorCode ?? null, imageUrl };
}

/** 1ª linha com texto (sem links), para identificar a oferta na fila. */
function titleOf(text: string): string | null {
  for (const line of text.split('\n')) {
    const clean = line.replace(/https?:\/\/\S+/g, '').trim();
    if (/[\p{L}\p{N}]/u.test(clean)) return [...clean].slice(0, TITLE_MAX).join('');
  }
  return null;
}
