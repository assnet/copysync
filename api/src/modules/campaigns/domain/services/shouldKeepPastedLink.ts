import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import { isAwinLink } from './detectMarketplace';
import { isShortLink } from './isShortLink';
import { verifyAffiliateLink } from './verifyAffiliateLink';

/** Link longo que já carrega o dono e vale como link de afiliado: Awin (Kabum) e vitrine `magazinevoce`. */
function isOwnedLongLink(provider: AffiliateProvider, source: URL): boolean {
  const host = source.hostname.toLowerCase().replace(/\.$/, '');
  if (provider === 'KABUM') return isAwinLink(source);
  if (provider === 'MAGALU') return host === 'magazinevoce.com.br' || host.endsWith('.magazinevoce.com.br');
  return false;
}

/**
 * Mantém o link colado só quando já é do tenant (`verified` sobre colado + expandido) **e** é link
 * curto oficial (`meli.la`, `onelink`…). Exceção: Kabum mantém o link Awin e Magalu o link
 * `magazinevoce` do tenant (não são curtos). Outro link longo do tenant é recriado; Amazon e
 * AliExpress sempre são reescritas. `credentialIdentifiers`: principal + vinculadas sob o limite do plano.
 */
export function shouldKeepPastedLink(
  provider: AffiliateProvider,
  source: URL,
  final: URL,
  credentialIdentifiers: string | readonly string[] | null,
): boolean {
  if (provider === 'AMAZON' || provider === 'ALIEXPRESS') return false;
  if (!isShortLink(source) && !isOwnedLongLink(provider, source)) return false;
  return verifyAffiliateLink(provider, [source, final], credentialIdentifiers) === 'verified';
}
