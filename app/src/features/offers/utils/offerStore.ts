import type { AffiliateProvider, MarketplaceAvailability } from '@/types/api.types';
import { toPanelPlanSlugs } from '@/features/plans/planSlug';
import { plansIn } from '@/features/plans/components/PlanAvailabilityBadges';

/**
 * Loja pelo host do link, só para o aviso "X detectado" no painel. A API decide de verdade
 * (allowlist, expansão de link curto e dono do link); aqui nada é bloqueado além do óbvio.
 */
const STORE_HOSTS: ReadonlyArray<[AffiliateProvider, readonly string[]]> = [
  ['SHOPEE', ['shopee.com.br', 's.shopee.com.br', 'shope.ee', 'shp.ee', 'shoope.top']],
  ['MERCADO_LIVRE', ['mercadolivre.com.br', 'mercadolivre.com', 'meli.la']],
  ['AMAZON', ['amazon.com.br', 'amzn.to', 'a.co', 'link.amazon', 'amzlinks.in']],
  ['SHEIN', ['br.shein.com', 'm.shein.com', 'onelink.shein.com']],
  ['KABUM', ['kabum.com.br']],
];

/** Lojas que todo tenant vê; as novas só entram quando a API diz que estão visíveis. */
export const DEFAULT_OFFER_STORES: readonly AffiliateProvider[] = ['SHOPEE', 'MERCADO_LIVRE', 'AMAZON', 'SHEIN'];

const AWIN_HOST = 'awin1.com';
const KABUM_AWIN_ADVERTISER = '17729';

/** Host igual ou subdomínio (`produto.mercadolivre.com.br`). */
const matchesHost = (host: string, base: string) => host === base || host.endsWith(`.${base}`);

/** Link Awin só é Kabum com anunciante 17729 e destino `ued` na Kabum (a API confere de novo). */
function isKabumAwin(url: URL): boolean {
  const mids = url.searchParams.getAll('awinmid');
  const dests = url.searchParams.getAll('ued');
  if (mids.length !== 1 || mids[0] !== KABUM_AWIN_ADVERTISER || dests.length !== 1) return false;
  try {
    const dest = new URL(dests[0]);
    return dest.protocol === 'https:' && matchesHost(dest.hostname.toLowerCase(), 'kabum.com.br');
  } catch {
    return false;
  }
}

function storeOf(url: URL): AffiliateProvider | null {
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (matchesHost(host, AWIN_HOST)) return isKabumAwin(url) ? 'KABUM' : null;
  for (const [provider, hosts] of STORE_HOSTS) {
    if (hosts.some((h) => matchesHost(host, h))) return provider;
  }
  return null;
}

/** `visible`: lojas da conta (audiência "Só super admin" já aplicada); loja fora dela = desconhecida. */
export function detectStore(raw: string, visible: readonly AffiliateProvider[] = DEFAULT_OFFER_STORES): AffiliateProvider | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const store = storeOf(url);
  return store && visible.includes(store) ? store : null;
}

/** Erro local do link ou `null`. Sem `https://` ou fora das lojas conhecidas não vale a ida ao servidor. */
export function linkProblem(
  raw: string,
  visible: readonly AffiliateProvider[] = DEFAULT_OFFER_STORES,
): 'required' | 'invalid' | 'unknownStore' | null {
  const value = raw.trim();
  if (!value) return 'required';
  try {
    if (new URL(value).protocol !== 'https:') return 'invalid';
  } catch {
    return 'invalid';
  }
  return detectStore(value, visible) ? null : 'unknownStore';
}

/** Disponibilidade por loja (`marketplaceAvailability` da lista de credenciais). Loja sem entrada = liberada (API antiga). */
export type OfferStoreAvailability = Partial<Record<AffiliateProvider, MarketplaceAvailability>>;

export type OfferStoreProblem = 'required' | 'invalid' | 'unknownStore' | 'notInPlan';

/**
 * Situação do link no gerador. Loja escondida pela audiência (fora de `visible`) segue `unknownStore`;
 * loja visível com `enabled === false` é `notInPlan` (orienta upgrade, nunca "não reconhecida").
 */
export function storeStatus(
  raw: string,
  visible: readonly AffiliateProvider[] = DEFAULT_OFFER_STORES,
  availability: OfferStoreAvailability = {},
): { problem: OfferStoreProblem | null; store: AffiliateProvider | null } {
  const problem = linkProblem(raw, visible);
  const store = problem ? null : detectStore(raw, visible);
  if (store && availability[store]?.enabled === false) return { problem: 'notInPlan', store };
  return { problem, store };
}

/**
 * Nomes dos planos que liberam a loja, na ordem da vitrine (mesma derivação do selo do card em
 * Credenciais de afiliado: `toPanelPlanSlugs` + `plansIn`). Vazio = a API não disse quais.
 */
export function storePlanNames(availability: OfferStoreAvailability, store: AffiliateProvider): string[] {
  return plansIn(toPanelPlanSlugs(availability[store]?.plans ?? []));
}
