import type { RedirectLinkData } from '../../domain/contracts/IRedirectLinkRepository';
import {
  parsePercentA,
  parseRedirectNote,
  parseRedirectSlug,
  validateRedirectDestination,
} from '../../domain/services/redirectLinkRules';
import { RedirectLinkInvalidError } from '../../../../shared/errors/internal/RedirectLinkErrors';

/** Campos editáveis. Em update, ausente = mantém; `urlB`/`note` null = remove. */
export interface RedirectLinkFields {
  slug?: string;
  urlA?: string;
  urlB?: string | null;
  percentA?: number;
  isActive?: boolean;
  note?: string | null;
}

/** Percentual padrão quando entra uma URL B sem percentual informado. */
const DEFAULT_SPLIT = 50;

/**
 * Valida e normaliza o estado final (criação ou mescla com o atual). Sem B o percentual é
 * sempre 100 (todo clique vai para A). Lança `RedirectLinkInvalidError` com o campo.
 */
export function buildRedirectLinkData(
  fields: RedirectLinkFields,
  current: RedirectLinkData | null,
  platformHosts: readonly string[],
): RedirectLinkData {
  const slug = parseRedirectSlug(fields.slug ?? current?.slug);
  if (!slug) throw new RedirectLinkInvalidError('slug', 'FORMAT');

  const a = validateRedirectDestination(fields.urlA ?? current?.urlA, platformHosts);
  if (!a.ok) throw new RedirectLinkInvalidError('urlA', a.reason);

  const rawB = fields.urlB !== undefined ? fields.urlB : current?.urlB ?? null;
  let urlB: string | null = null;
  if (rawB !== null && rawB.trim() !== '') {
    const b = validateRedirectDestination(rawB, platformHosts);
    if (!b.ok) throw new RedirectLinkInvalidError('urlB', b.reason);
    urlB = b.url;
  }

  let percentA = 100;
  if (urlB) {
    const hadB = Boolean(current?.urlB);
    const raw = fields.percentA ?? (hadB ? current!.percentA : DEFAULT_SPLIT);
    const parsed = parsePercentA(raw);
    if (parsed === null) throw new RedirectLinkInvalidError('percentA', 'RANGE');
    percentA = parsed;
  } else if (fields.percentA !== undefined && parsePercentA(fields.percentA) === null) {
    throw new RedirectLinkInvalidError('percentA', 'RANGE');
  }

  const note = parseRedirectNote(fields.note !== undefined ? fields.note : current?.note ?? null);
  if (note === undefined) throw new RedirectLinkInvalidError('note', 'TOO_LONG');

  return { slug, urlA: a.url, urlB, percentA, isActive: fields.isActive ?? current?.isActive ?? true, note };
}
