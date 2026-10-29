import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { IOfferDispatchRepository } from '../../domain/contracts/IOfferDispatchRepository';
import type { IOfferRepository } from '../../domain/contracts/IOfferRepository';
import type { OfferOrigin } from '../../domain/enums/OfferOrigin';
import { appendToLanes, laneGapMs, laneTailsFromOpen } from '../../domain/services/appendToLanes';
import { scheduleDispatches } from '../../domain/services/scheduleDispatches';
import { OfferAlreadySentError } from '../../../../shared/errors/internal/OfferErrors';

export interface EnqueueOfferInput {
  tenantId: string;
  /** Grupos na ordem de envio, cada um com a sessão que envia (faixa própria). */
  destinations: { conversationId: string; sessionId: string }[];
  origin: OfferOrigin;
  provider: AffiliateProvider;
  sourceUrl: string;
  affiliateUrl: string;
  title: string | null;
  text: string;
  imageUrl: string | null;
  coupon: string | null;
  mentionAll: boolean;
  simulateTyping: boolean;
  typingSeconds: number;
  /** 1º envio não antes disso (a fila da sessão pode empurrar para depois). */
  startAt: Date;
  /** Validade: nada sai depois disso. */
  expiresAt: Date | null;
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  /**
   * Chave idempotente (ex.: `captured:<id>`). Já existe oferta com ela: devolve essa oferta e não
   * cria outra (reprocessar depois de uma queda não posta duas vezes).
   */
  sourceKey?: string;
  /**
   * Encaixa cada horário previsto (ex.: na janela de operação do monitoramento). Aplicado em ordem,
   * preservando o espaçamento entre envios: `t_i = fit(t_{i-1} + gap_i)`. O claim do worker garante
   * a regra no envio; isto deixa a fila mostrar horários reais.
   */
  fitSlot?: (at: Date) => Date;
  /** Configuração do monitoramento de origem: o claim aplica a janela dela, seja qual for a sessão que envia. */
  monitorConfigId?: string;
}

export type EnqueueOfferResult =
  | { kind: 'queued'; offerId: string; firstSendAt: Date }
  /** A fila da sessão empurraria o 1º envio para depois da validade: nada foi criado. */
  | { kind: 'expired'; firstSendAt: Date };

export interface EnqueueOfferDeps {
  offers: IOfferRepository;
  dispatches: IOfferDispatchRepository;
  rand?: () => number;
}

/**
 * Oferta pronta (texto, link do tenant, destinos) vinda de outro módulo (ex.: monitoramento de
 * grupos) → oferta SENDING na fila de envio, com o mesmo agendamento por faixa do gerador
 * (docs/fila-de-envio.md); destinos de sessões diferentes caem cada um na sua faixa. Quem envia é
 * o worker; validade checada lá também.
 */
/** Reaplica `fit` em cadeia: cada horário parte do anterior já encaixado, mantendo o espaçamento. */
function fitSlots(slots: readonly Date[], fit: (at: Date) => Date): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < slots.length; i++) {
    const gap = i === 0 ? 0 : slots[i]!.getTime() - slots[i - 1]!.getTime();
    out.push(fit(i === 0 ? slots[0]! : new Date(out[i - 1]!.getTime() + gap)));
  }
  return out;
}

export class EnqueueOfferUseCase {
  constructor(private readonly deps: EnqueueOfferDeps) {}

  async execute(input: EnqueueOfferInput): Promise<EnqueueOfferResult> {
    const { tenantId, destinations } = input;
    if (destinations.length === 0) throw new Error('EnqueueOfferUseCase: no destinations');
    let draft: { id: string; mentionAll: boolean } | null = null;
    if (input.sourceKey) {
      const existing = await this.deps.offers.findBySourceKey(tenantId, input.sourceKey);
      // Queda entre criar a oferta e enfileirar: ela ficou DRAFT sem envios; enfileira agora
      // Mesma captura: os campos gravados valem (o mentionAll esperado é o da linha, senão startSending recusa)
      if (existing?.status === 'DRAFT') draft = { id: existing.id, mentionAll: existing.mentionAll };
      else if (existing) {
        const first = (await this.deps.dispatches.listByOffer(existing.id, tenantId))
          .reduce<Date | null>((min, d) => (!min || d.notBefore < min ? d.notBefore : min), null);
        return { kind: 'queued', offerId: existing.id, firstSendAt: first ?? input.startAt };
      }
    }

    const interval = { minMs: input.intervalMinSeconds * 1000, maxMs: input.intervalMaxSeconds * 1000 };
    const planned = scheduleDispatches(destinations.length, input.startAt, interval, this.deps.rand);
    // Uma faixa por sessão: a oferta inteira entra depois do que já está à frente em qualquer delas
    const sessionIds = [...new Set(destinations.map((d) => d.sessionId))];
    // Fim do bloco ocupado de cada sessão (buraco maior que o intervalo máximo libera a faixa)
    const openBySession = new Map<string, Date[]>();
    for (const sessionId of sessionIds) {
      openBySession.set(sessionId, await this.deps.dispatches.openNotBefore(tenantId, sessionId, planned[0]!));
    }
    const tails = laneTailsFromOpen(openBySession, planned[0]!, interval.maxMs);
    const laned = tails.size === 0
      ? planned
      : appendToLanes(destinations.map((d, i) => ({ sessionId: d.sessionId, notBefore: planned[i]! })), tails, laneGapMs(interval, this.deps.rand));
    const slots = input.fitSlot ? fitSlots(laned, input.fitSlot) : laned;
    const firstSendAt = slots[0]!;
    if (input.expiresAt && firstSendAt.getTime() >= input.expiresAt.getTime()) return { kind: 'expired', firstSendAt };

    const offer = draft ? { id: draft.id } : await this.deps.offers.create({
      tenantId,
      provider: input.provider,
      sourceUrl: input.sourceUrl,
      productRef: null,
      title: input.title,
      priceCents: null,
      originalPriceCents: null,
      imageUrl: input.imageUrl,
      affiliateUrl: input.affiliateUrl,
      attributionVerified: true,
      text: input.text,
      coupon: input.coupon,
      audience: 'STANDARD',
      scheduledAt: null,
      createdById: null,
      origin: input.origin,
      expiresAt: input.expiresAt,
      mentionAll: input.mentionAll,
      simulateTyping: input.simulateTyping,
      typingSeconds: input.typingSeconds,
      sourceKey: input.sourceKey ?? null,
      monitorConfigId: input.monitorConfigId ?? null,
    });
    const created = await this.deps.dispatches.startSending(
      offer.id,
      tenantId,
      { mentionAll: draft?.mentionAll ?? input.mentionAll },
      destinations.map((d, i) => ({ conversationId: d.conversationId, sessionId: d.sessionId, notBefore: slots[i]!, gapSeconds: input.intervalMinSeconds })),
    );
    // Oferta acabou de nascer DRAFT: só falha se algo a mudou no meio (não deveria)
    if (!created) throw new OfferAlreadySentError(offer.id);
    return { kind: 'queued', offerId: offer.id, firstSendAt };
  }
}
