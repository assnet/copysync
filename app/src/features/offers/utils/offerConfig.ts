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

/** Espelha a validação da API: 5 ≤ min ≤ max ≤ 120. */
export const INTERVAL_MIN_SECONDS = 5;
export const INTERVAL_MAX_SECONDS = 120;
export const DEFAULT_INTERVAL = { min: 8, max: 15 } as const;

export function intervalValid(min: number, max: number): boolean {
  return Number.isInteger(min) && Number.isInteger(max)
    && min >= INTERVAL_MIN_SECONDS && max <= INTERVAL_MAX_SECONDS && min <= max;
}
