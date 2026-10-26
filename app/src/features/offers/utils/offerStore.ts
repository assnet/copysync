import type { AffiliateProvider } from '@/types/api.types';

/**
 * Loja pelo host do link, só para o aviso "X detectado" no painel. A API decide de verdade
 * (allowlist, expansão de link curto e dono do link); aqui nada é bloqueado além do óbvio.
 */
const STORE_HOSTS: ReadonlyArray<[AffiliateProvider, readonly string[]]> = [
  ['SHOPEE', ['shopee.com.br', 's.shopee.com.br', 'shope.ee']],
  ['MERCADO_LIVRE', ['mercadolivre.com.br', 'mercadolivre.com', 'meli.la']],
  ['AMAZON', ['amazon.com.br', 'amzn.to']],
];

/** Host igual ou subdomínio (`produto.mercadolivre.com.br`). */
const matchesHost = (host: string, base: string) => host === base || host.endsWith(`.${base}`);

export function detectStore(raw: string): AffiliateProvider | null {
  let host: string;
  try {
    host = new URL(raw.trim()).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
  for (const [provider, hosts] of STORE_HOSTS) {
    if (hosts.some((h) => matchesHost(host, h))) return provider;
  }
  return null;
}

/** Erro local do link ou `null`. Sem `https://` ou fora das lojas conhecidas não vale a ida ao servidor. */
export function linkProblem(raw: string): 'required' | 'invalid' | 'unknownStore' | null {
  const value = raw.trim();
  if (!value) return 'required';
  try {
    if (new URL(value).protocol !== 'https:') return 'invalid';
  } catch {
    return 'invalid';
  }
  return detectStore(value) ? null : 'unknownStore';
}
