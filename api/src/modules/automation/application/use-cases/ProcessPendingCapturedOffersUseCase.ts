import { effectiveImageMode } from '../../../campaigns/domain/enums/OfferImageMode';
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
import { resolveStartWithinWindow, type OperatingWindow } from '../../domain/services/operatingWindow';
import { weekdaysMask } from '../../../campaigns/domain/services/postingWindow';
import { logger } from '../../../../shared/logger/logger';
import { AI_REWRITE_ENABLED, CROSS_SESSION_DISPATCH, ENRICH_LINK_ONLY_ENABLED, MENTION_ALL_ENABLED } from './GroupMonitorConfigUseCases';
import { keepOneSessionPerChannel, limitKeyOfChannel, requiresCrossSession, sliceByChannel } from '../../../tenants/domain/channelLimits';

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

/**
 * Contexto opcional de uma rodada. `signal` abortado = parada do worker: nenhum claim ou enqueue
 * novo começa; o que já começou termina e é marcado. Sem sinal = comportamento de sempre.
 */
export interface CapturedOffersRunContext {
  signal?: AbortSignal;
}

type Outcome =
  | { status: 'QUEUED'; data: CapturedOfferResolution & { offerId: string } }
  | { status: 'SKIPPED' | 'FAILED'; reason: Parameters<ICapturedOfferRepository['markSkipped']>[2]; data?: Partial<CapturedOfferResolution> };

/** Parada observada antes do enqueue: a captura fica PROCESSING e volta pelo stale (não é falha). */
class CaptureStoppedError extends Error {}

/**
 * Um tick do processamento de capturas (roda no tick do worker de envio). Para cada captura:
 * link do tenant para cada link de produto (o resto é removido), cupom e validade, início dentro
 * da janela de operação, e entrada na fila de envio da sessão. Oferta/cupom que venceria antes
 * de sair é descartada (EXPIRED). Ver docs/monitoramento-grupos.md §3.
 */
export class ProcessPendingCapturedOffersUseCase {
  constructor(private readonly deps: ProcessPendingCapturedOffersDeps) {}

  async execute(ctx: CapturedOffersRunContext = {}): Promise<{ processed: number }> {
    const nowFn = this.deps.now ?? (() => new Date());
    const now = nowFn();
    const clock = this.deps.clock ?? Date.now;
    const started = clock();
    const { signal } = ctx;
    let processed = 0;
    // Uma por vez enquanto houver orçamento: nada fica reivindicado sem ser processado
    while (processed < CAPTURE_BATCH_SIZE && (processed === 0 || clock() - started < CAPTURE_TICK_BUDGET_MS)) {
      if (signal?.aborted) break;
      const [c] = await this.deps.captured.claimPending(1, new Date(now.getTime() - CAPTURE_STALE_MS));
      if (!c) break;
      processed++;
      const itemStarted = clock();
      // Claim que voltou depois da parada: fica PROCESSING e o stale devolve (sem renovar validade)
      if (signal?.aborted) {
        logger.info({ capturedOfferId: c.id, tenantId: c.tenantId }, 'captured offer left for recovery at stop');
        break;
      }
      let outcome: Outcome;
      try {
        outcome = await this.resolve(c, nowFn(), signal);
      } catch (err) {
        if (err instanceof CaptureStoppedError) {
          logger.info({ capturedOfferId: c.id, tenantId: c.tenantId }, 'captured offer left for recovery at stop');
          break;
        }
        logger.error({ err: (err as Error)?.name, capturedOfferId: c.id, tenantId: c.tenantId }, 'captured offer processing failed');
        outcome = { status: 'FAILED', reason: 'INTERNAL_ERROR' };
      }
      // Enqueue já feito: marca mesmo com sinal abortado (senão a oferta sai e a captura volta)
      await this.mark(c, outcome);
      observeCapture(c, outcome, nowFn(), clock() - itemStarted);
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

  private async resolve(c: CapturedOffer, now: Date, signal?: AbortSignal): Promise<Outcome> {
    const { monitors, links, queue, entitlements } = this.deps;
    const config = await monitors.findConfig(c.tenantId, c.sessionId);
    if (!config?.enabled) return { status: 'SKIPPED', reason: 'MONITOR_DISABLED' };
    let targets = await monitors.listBroadcast(c.tenantId, c.sessionId);
    const engines = await monitors.sessionEngines(c.tenantId, [c.sessionId, ...targets.map((t) => t.sessionId)]);
    const engineOf = (id: string) => engines.get(id) ?? 'baileys';
    // Plano rebaixado depois de salvar: sem sessão cruzada, uma sessão por canal (a do monitor no canal dela)
    const sessionsUsed = [c.sessionId, ...targets.map((t) => t.sessionId)].map((id) => ({ id, engine: engineOf(id) }));
    if (requiresCrossSession(sessionsUsed) && (await entitlements.getBoolean(c.tenantId, CROSS_SESSION_DISPATCH)) !== true) {
      targets = keepOneSessionPerChannel(targets, (t) => t.sessionId, engineOf, { id: c.sessionId, engine: engineOf(c.sessionId) });
    }
    // Plano rebaixado depois de salvar: envia só até o limite atual de cada canal (ordem da lista)
    const limits = {
      whatsapp: await entitlements.getNumber(c.tenantId, limitKeyOfChannel('broadcastGroups', 'whatsapp')),
      telegram: await entitlements.getNumber(c.tenantId, limitKeyOfChannel('broadcastGroups', 'telegram')),
    };
    targets = sliceByChannel(targets, (t) => engineOf(t.sessionId), (ch) => limits[ch]);
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
      // Ramos próprios com return: sem eles o link cairia em `replacements` como null e sumiria do texto
      if (r.kind === 'plan_unavailable') return { status: 'SKIPPED', reason: 'MARKETPLACE_PLAN_UNAVAILABLE', data: { marketplace: r.provider } };
      if (r.kind === 'risk_not_accepted') return { status: 'SKIPPED', reason: 'MARKETPLACE_RISK_NOT_ACCEPTED', data: { marketplace: r.provider } };
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
    // Validade conta do início previsto a partir da CAPTURA (captura fora da janela acumula e vale a
    // partir da abertura); atraso de processamento não renova a validade
    // Faixa + dias da semana: captura no domingo com seg–sex abre na segunda
    const window: OperatingWindow = {
      startMinute: config.windowStartMinute, endMinute: config.windowEndMinute, weekdaysMask: weekdaysMask(config.weekdays),
    };
    const plannedFromCapture = new Date(c.capturedAt.getTime() + config.startDelaySeconds * 1000);
    const expiresAt = captureExpiresAt(resolveStartWithinWindow(plannedFromCapture, window), coupon !== null, config);
    const earliest = new Date(Math.max(now.getTime(), plannedFromCapture.getTime()));
    const startAt = resolveStartWithinWindow(earliest, window);
    // "Montar só com link" é Pro/Max: plano rebaixado com a opção salva cai no texto original
    const enrichAllowed = config.enrichLinkOnly && (await entitlements.getBoolean(c.tenantId, ENRICH_LINK_ONLY_ENABLED)) === true;
    // Reescrita com IA é PRO/MAX: LITE com IA salva cai no Modelo (sem chamar a IA, sem selo de falha)
    const aiLocked = config.textMode === 'AI' && (await entitlements.getBoolean(c.tenantId, AI_REWRITE_ENABLED)) === false;
    const effective = enrichAllowed === config.enrichLinkOnly && !aiLocked
      ? config
      : { ...config, enrichLinkOnly: enrichAllowed, ...(aiLocked && { textMode: 'TEMPLATE' as const, audience: 'STANDARD' as const }) };
    const built = await this.buildText(c, effective, first, coupon, finalText, tenantLinks);
    const base: CapturedOfferResolution = {
      marketplace: first.provider, sourceUrl: first.sourceUrl, affiliateUrl: first.affiliateUrl, coupon,
      finalText: built.text, textSource: built.textSource, aiErrorCode: built.aiErrorCode, expiresAt, startsAt: null,
    };

    const mentionAll = config.mentionAll && (await entitlements.getBoolean(c.tenantId, MENTION_ALL_ENABLED)) !== false;
    // Último ponto antes do efeito: parada aqui não cria oferta nem marca falha
    if (signal?.aborted) throw new CaptureStoppedError();
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
      imageMode: effectiveImageMode(config.imageMode),
      simulateTyping: config.simulateTyping,
      typingSeconds: config.typingSeconds,
      startAt,
      expiresAt,
      intervalMinSeconds: config.intervalMinSeconds,
      intervalMaxSeconds: config.intervalMaxSeconds,
      // Queda entre criar a oferta e marcar QUEUED: o reprocessamento reaproveita a oferta
      sourceKey: `captured:${c.id}`,
      // Todos os envios dentro da janela (o fim empurra para o próximo início); o claim garante no envio
      fitSlot: (at) => resolveStartWithinWindow(at, window),
      monitorConfigId: config.id,
    });
    if (res.kind === 'expired') return { status: 'SKIPPED', reason: 'EXPIRED', data: { ...base, startsAt: res.firstSendAt } };
    return { status: 'QUEUED', data: { ...base, startsAt: res.firstSendAt, offerId: res.offerId } };
  }
}

/**
 * Um log por captura processada (docs/monitoramento-grupos.md): idade desde a captura (não é
 * latência WhatsApp→evento), duração da preparação e resultado. Só IDs e códigos: sem texto,
 * link, título, nome ou erro bruto. Falha aqui nunca muda o resultado da fila.
 */
function observeCapture(c: CapturedOffer, o: Outcome, now: Date, durationMs: number): void {
  try {
    logger.info({
      capturedOfferId: c.id, tenantId: c.tenantId, sessionId: c.sessionId, status: o.status,
      reason: o.status === 'QUEUED' ? null : o.reason,
      captureAgeMs: Math.max(0, now.getTime() - c.capturedAt.getTime()), durationMs: Math.max(0, durationMs),
    }, 'captured offer observed');
  } catch {
    // observação é melhor esforço
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
  if (!wantsProduct) {
    // Texto original sem foto na mensagem (link com prévia, vídeo): a foto vem do produto
    return c.sourceMediaUrl ? original : { ...original, imageUrl: await productImageOnly(deps, c, link) };
  }

  // Vitrine social do ML já trouxe o produto junto com o link: reler `/p/MLB…` costuma dar captcha
  const product = link.product ?? (await deps.products.read(c.tenantId, link.provider, link.sourceUrl));
  if (!product || (!product.title && product.priceCents == null)) {
    logger.info({ capturedOfferId: c.id, tenantId: c.tenantId, marketplace: link.provider }, 'captured offer product data unavailable');
    if (c.sourceMediaUrl || !product?.imageUrl) return original;
    return { ...original, imageUrl: await deps.images.store(product.imageUrl) };
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

/** Só a foto do produto (modo original): melhor esforço, falha vira oferta só com texto. */
async function productImageOnly(
  deps: Pick<ProcessPendingCapturedOffersDeps, 'products' | 'images'>,
  c: CapturedOffer,
  link: Extract<TenantLinkResult, { kind: 'ok' }>,
): Promise<string | null> {
  try {
    const product = link.product?.imageUrl ? link.product : await deps.products.read(c.tenantId, link.provider, link.sourceUrl);
    return product?.imageUrl ? await deps.images.store(product.imageUrl) : null;
  } catch (err) {
    logger.warn({ capturedOfferId: c.id, tenantId: c.tenantId, marketplace: link.provider, err: (err as Error)?.name }, 'captured offer product image unavailable');
    return null;
  }
}

/** 1ª linha com texto (sem links), para identificar a oferta na fila. */
function titleOf(text: string): string | null {
  for (const line of text.split('\n')) {
    const clean = line.replace(/https?:\/\/\S+/g, '').trim();
    if (/[\p{L}\p{N}]/u.test(clean)) return [...clean].slice(0, TITLE_MAX).join('');
  }
  return null;
}
