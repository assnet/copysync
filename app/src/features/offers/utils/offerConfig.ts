import { Baby, CookingPot, Dumbbell, Image, Link2, PawPrint, Shirt, Tag, User, type LucideIcon } from 'lucide-react';
import type { BroadcastGroupsResponse, LimitChannel, OfferAudience, OfferConfigSettings, OfferImageMode, SaveOfferConfigRequest } from '@/types/api.types';
import type { PostingWindowValue } from '@/components/PostingWindowField';
import {
  ALL_WEEKDAYS_MASK, DAY_MINUTES, isWeekdaysMaskValid, isWindowValid, maskToWeekdays, weekdaysToMask, windowFromSettings, windowToSettings,
} from '@/features/monitoring/utils/operatingWindow';

/** Ordem dos cartões de público-alvo. */
export const OFFER_AUDIENCES: readonly OfferAudience[] = [
  'STANDARD', 'MOMS', 'PET', 'BEAUTY_FASHION', 'MEN', 'FITNESS', 'HOME_KITCHEN',
];

/** Público que vale de fato: sem "Reescrita com IA" no plano, só o Padrão (o servidor usa o modelo fixo). */
export const effectiveAudience = (audience: OfferAudience, aiLocked: boolean): OfferAudience =>
  aiLocked ? 'STANDARD' : audience;

/** Ícone de cada público (Lucide, via `AppIcon`). Texto fica em `strings.ts`. */
export const AUDIENCE_ICONS: Record<OfferAudience, LucideIcon> = {
  STANDARD: Tag,
  MOMS: Baby,
  PET: PawPrint,
  BEAUTY_FASHION: Shirt,
  MEN: User,
  FITNESS: Dumbbell,
  HOME_KITCHEN: CookingPot,
};

/** Formatos da foto no envio, na ordem do seletor. `LINK_PREVIEW` é o padrão. */
export const OFFER_IMAGE_MODES: readonly OfferImageMode[] = ['MEDIA', 'LINK_PREVIEW'];
export const DEFAULT_IMAGE_MODE: OfferImageMode = 'LINK_PREVIEW';
/**
 * "Imagem com legenda" desligada para todos os planos até nova decisão: aparece desabilitada e o
 * salvo com `MEDIA` vale como prévia do link. Espelha `MEDIA_IMAGE_MODE_ENABLED` da API.
 */
export const MEDIA_IMAGE_MODE_ENABLED = false;
export const isImageModeAvailable = (mode: OfferImageMode) => mode !== 'MEDIA' || MEDIA_IMAGE_MODE_ENABLED;
/** Formato que vale de fato (o que a tela mostra, salva e envia). */
export const effectiveImageMode = (mode: OfferImageMode | null | undefined): OfferImageMode =>
  mode && isImageModeAvailable(mode) ? mode : DEFAULT_IMAGE_MODE;
export const IMAGE_MODE_ICONS: Record<OfferImageMode, LucideIcon> = { MEDIA: Image, LINK_PREVIEW: Link2 };

/** "Digitando…" antes do envio. Espelha `campaigns/domain/offerTyping.ts` da API. */
export const TYPING_SECONDS_MIN = 1;
export const TYPING_SECONDS_MAX = 30;

/** Espelha a validação da API: 60 ≤ min ≤ max ≤ 3600 s. O painel mostra minutos inteiros. */
export const INTERVAL_MIN_SECONDS = 60;
export const INTERVAL_MAX_SECONDS = 3600;
export const INTERVAL_STEP_SECONDS = 60;
export const DEFAULT_INTERVAL = { min: 120, max: 300 } as const;

/** Média do intervalo a partir da qual o termômetro considera o envio seguro. */
export const INTERVAL_SAFE_MEAN_SECONDS = 600;

export type IntervalRiskLevel = 'high' | 'elevated' | 'moderate' | 'safe';

export interface IntervalRisk {
  /** 0 = colado no mínimo da escala (alto risco) … 1 = média ≥ meta segura. */
  score: number;
  level: IntervalRiskLevel;
}

/**
 * Termômetro de risco do intervalo entre grupos: quanto maior a MÉDIA da pausa, mais seguro.
 * Curva em raiz: o ganho é maior nos primeiros minutos (1 → 3 min pesa mais que 7 → 9).
 */
export function intervalRisk(minSeconds: number, maxSeconds: number): IntervalRisk {
  const mean = (minSeconds + maxSeconds) / 2;
  const t = (mean - INTERVAL_MIN_SECONDS) / (INTERVAL_SAFE_MEAN_SECONDS - INTERVAL_MIN_SECONDS);
  const score = Math.sqrt(Math.min(1, Math.max(0, t)));
  const level: IntervalRiskLevel = score < 0.25 ? 'high' : score < 0.5 ? 'elevated' : score < 0.75 ? 'moderate' : 'safe';
  return { score, level };
}

export function intervalValid(min: number, max: number): boolean {
  return Number.isInteger(min) && Number.isInteger(max)
    && min >= INTERVAL_MIN_SECONDS && max <= INTERVAL_MAX_SECONDS && min <= max;
}

/** Canais com limite próprio no plano, na ordem de exibição. */
export const CHANNELS: readonly LimitChannel[] = ['whatsapp', 'telegram'];

/** Quantos itens por canal (canal da sessão; o de um grupo é o da sessão dona). */
export function countByChannel(channels: readonly LimitChannel[]): Record<LimitChannel, number> {
  const out: Record<LimitChannel, number> = { whatsapp: 0, telegram: 0 };
  for (const ch of channels) out[ch]++;
  return out;
}

/**
 * Grupos de disparo por canal no rascunho do gerador, pela união com o monitoramento (BG-03):
 * parte de `usage.<canal>.broadcastGroups` do catálogo, tira o que só o gerador usava e saiu do
 * rascunho e soma os marcados que ainda não estão em uso. A chave é o `conversationId`
 * (sessão + grupo), então o mesmo grupo nunca conta duas vezes. Sem catálogo, conta só o rascunho.
 */
export function unionBroadcastCount(
  draft: readonly { id: string; channel: LimitChannel }[],
  catalog: Pick<BroadcastGroupsResponse, 'items' | 'usage'> | null,
): Record<LimitChannel, number> {
  if (!catalog) return countByChannel(draft.map((g) => g.channel));
  const out: Record<LimitChannel, number> = { whatsapp: catalog.usage.whatsapp.broadcastGroups, telegram: catalog.usage.telegram.broadcastGroups };
  const inDraft = new Set(draft.map((g) => g.id));
  const inUse = new Set(catalog.items.map((i) => i.conversationId));
  for (const item of catalog.items) {
    if (!inDraft.has(item.conversationId) && item.usedBy.every((u) => u === 'generator')) out[item.channel]--;
  }
  const added = new Set<string>();
  for (const g of draft) {
    if (inUse.has(g.id) || added.has(g.id)) continue;
    added.add(g.id);
    out[g.channel]++;
  }
  return { whatsapp: Math.max(0, out.whatsapp), telegram: Math.max(0, out.telegram) };
}

/** Horário salvo do gerador → valor do `PostingWindowField`; sem configuração, dia inteiro e todos os dias. */
export function postingWindowFromConfig(config: OfferConfigSettings | null): PostingWindowValue {
  if (!config) return { window: windowFromSettings(0, DAY_MINUTES), weekdaysMask: ALL_WEEKDAYS_MASK };
  const mask = weekdaysToMask(config.weekdays);
  return {
    window: windowFromSettings(config.windowStartMinute, config.windowEndMinute),
    weekdaysMask: mask > 0 ? mask : ALL_WEEKDAYS_MASK,
  };
}

/** Valor do `PostingWindowField` → campos do `PUT /offers/config`. */
export function postingWindowToRequest(value: PostingWindowValue): Pick<SaveOfferConfigRequest, 'windowStartMinute' | 'windowEndMinute' | 'weekdays'> {
  return { ...windowToSettings(value.window), weekdays: maskToWeekdays(value.weekdaysMask) };
}

/** Faixa com algum horário livre e ao menos um dia marcado. */
export function postingWindowValid(value: PostingWindowValue): boolean {
  return isWindowValid(value.window) && isWeekdaysMaskValid(value.weekdaysMask);
}
