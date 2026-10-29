/**
 * Separa o Host público em domínio + slug. Função pura (sem banco).
 * - Normaliza: trim, minúsculo, sem porta (`:443`, `[::1]:80`) e sem ponto final.
 * - Host igual a um domínio, ou `www.` + domínio → apex. Exatamente um rótulo antes do domínio → slug.
 * - Mais de um rótulo (`www.slug.dom`), rótulo vazio ou nenhum domínio casado → null (404).
 * Vários domínios casando (ex.: `dom` e `sub.dom`): vence o mais longo.
 */
export type PublicHostMatch<D> = { kind: 'apex'; domain: D } | { kind: 'slug'; domain: D; slug: string };

export function normalizeHost(raw: string): string {
  let host = raw.trim().toLowerCase();
  if (host.startsWith('[')) return ''; // IP v6 literal: nunca é domínio de link
  host = host.replace(/:\d*$/, '');
  return host.replace(/\.+$/, '');
}

export function matchPublicHost<D extends { hostname: string }>(
  rawHost: string,
  domains: readonly D[],
): PublicHostMatch<D> | null {
  const host = normalizeHost(rawHost);
  if (!host) return null;
  let best: PublicHostMatch<D> | null = null;
  let bestLength = -1;
  for (const domain of domains) {
    const name = normalizeHost(domain.hostname);
    if (!name || name.length <= bestLength) continue;
    if (host === name) {
      best = { kind: 'apex', domain };
      bestLength = name.length;
    } else if (host.endsWith(`.${name}`)) {
      const prefix = host.slice(0, -(name.length + 1));
      // `www.<domínio>` (o guia de DNS cria o CNAME) é o domínio puro; `www` é nome reservado.
      if (prefix === 'www') best = { kind: 'apex', domain };
      else best = prefix && !prefix.includes('.') ? { kind: 'slug', domain, slug: prefix } : null;
      bestLength = name.length;
    }
  }
  return best;
}
