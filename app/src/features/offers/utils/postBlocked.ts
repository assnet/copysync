import type { PostBlockedReason } from '@/types/api.types';
import { offerStrings } from '../strings';

const t = offerStrings.postBlocked;

/** Motivo de não poder postar: curto (sempre visível) e longo (tooltip). Sem motivo = texto genérico. */
export function postBlockedText(reason: PostBlockedReason | null | undefined): { short: string; long: string } {
  return reason ? { short: t.short[reason], long: t.long[reason] } : { short: t.unknownShort, long: t.unknownLong };
}

/** Só `false` bloqueia: `null`/ausente = desconhecido, sem aviso. */
export const isUnpostable = (g: { canPost?: boolean | null }) => g.canPost === false;
