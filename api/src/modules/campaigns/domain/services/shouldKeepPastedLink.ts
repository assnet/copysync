import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import { isShortLink } from './isShortLink';
import { verifyAffiliateLink } from './verifyAffiliateLink';

/**
 * Mantém o link colado só quando já é do tenant (`verified` sobre colado + expandido) **e** é link
 * curto oficial (`meli.la`, `onelink`…). Link longo do tenant é recriado; Amazon sempre é reescrita.
 * `credentialIdentifiers`: principal + vinculadas sob o limite do plano.
 */
export function shouldKeepPastedLink(
  provider: AffiliateProvider,
  source: URL,
  final: URL,
  credentialIdentifiers: string | readonly string[] | null,
): boolean {
  if (provider === 'AMAZON') return false;
  if (!isShortLink(source)) return false;
  return verifyAffiliateLink(provider, [source, final], credentialIdentifiers) === 'verified';
}
