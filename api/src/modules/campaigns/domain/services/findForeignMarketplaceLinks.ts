import { detectMarketplace } from './detectMarketplace';
import { extractUrls, toHref, type FoundUrl } from './extractUrls';

function isMarketplaceHref(href: string): boolean {
  try {
    return detectMarketplace(new URL(href)) !== null;
  } catch {
    return false;
  }
}

/**
 * Links de marketplace **acrescentados** na edição do texto da oferta (D3, TLINK-21). Função pura,
 * sem rede: não dá para provar o dono do link, então qualquer caminho nos hosts suportados conta.
 *
 * Conta quem: tem host de marketplace (`detectMarketplace`, que aceita `http://` e link sem
 * protocolo), não é o `affiliateUrl` e não estava no texto gravado. Comparação pelo `href` do
 * `extractUrls` nos dois lados. Links que já estavam ficam (oferta do monitoramento nasce com
 * vários links do tenant e só o 1º vira `affiliateUrl`); convite de grupo e outros hosts passam.
 */
export function findForeignMarketplaceLinks(
  newText: string,
  storedText: string | null | undefined,
  affiliateUrl: string | null | undefined,
): FoundUrl[] {
  const known = new Set(extractUrls(storedText ?? '').map((u) => u.href));
  const affiliate = affiliateUrl?.trim();
  if (affiliate) known.add(toHref(affiliate));
  return extractUrls(newText).filter((u) => !known.has(u.href) && isMarketplaceHref(u.href));
}
