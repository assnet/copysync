import { Baby, CookingPot, Dumbbell, PawPrint, Shirt, Tag, User, type LucideIcon } from 'lucide-react';
import type { OfferAudience } from '@/types/api.types';

/** Ordem dos cartões de público-alvo. */
export const OFFER_AUDIENCES: readonly OfferAudience[] = [
  'STANDARD', 'MOMS', 'PET', 'BEAUTY_FASHION', 'MEN', 'FITNESS', 'HOME_KITCHEN',
];

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
