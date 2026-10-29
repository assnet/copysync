import { ROTATION_RANGES } from './types';

/**
 * Nome do link enquanto o usuário digita: minúsculo, sem acento, espaço/underscore → hífen,
 * só `a-z0-9-`, hífens colapsados, sem hífen no início, corte em 50. O hífen do fim fica
 * (o usuário pode estar no meio de "loja-vip"); `finalizeSlug` o remove ao salvar.
 * Mesma regra de `api/.../domain/services/slugRules.ts#normalizeSlug`; a API revalida.
 */
export function normalizeSlugInput(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .slice(0, ROTATION_RANGES.slug.max);
}

/** Valor enviado à API. */
export function finalizeSlug(value: string): string {
  return normalizeSlugInput(value).replace(/-+$/, '');
}

export type SlugProblem = 'required' | 'tooShort' | null;

/** Validação local do valor já finalizado (a API continua dona da regra e da reserva). */
export function slugProblem(value: string): SlugProblem {
  if (!value) return 'required';
  if (value.length < ROTATION_RANGES.slug.min) return 'tooShort';
  return null;
}

export const previewUrl = (slug: string, hostname: string) => `https://${slug}.${hostname}`;
