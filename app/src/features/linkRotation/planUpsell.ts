import { AFFILIATE_PLANS_PATH } from '@/features/navigation';
import { PLAN_CATALOG, type PlanCatalogItem } from '@/features/plans/catalog';

/**
 * Limite de plano que pode acionar o aviso de upgrade: rodízios e grupos por link (rodízio de links;
 * `rotations`/`groups` = WhatsApp, `telegramLinkRotations`/`telegramLinkRotationGroups` = Telegram),
 * sessões por canal (tela de sessões) e grupos monitorados/de disparo por canal (Monitoramento e
 * Gerador de ofertas) e etiquetas de afiliado do Mercado Livre (link com etiqueta da conta sem vaga).
 */
export type PlanLimitKind =
  | 'rotations'
  | 'groups'
  | 'telegramLinkRotations'
  | 'telegramLinkRotationGroups'
  | 'whatsappSessions'
  | 'telegramSessions'
  | 'whatsappMonitoredGroups'
  | 'telegramMonitoredGroups'
  | 'whatsappBroadcastGroups'
  | 'telegramBroadcastGroups'
  | 'mercadoLivreTags';

export interface NextPlanOffer {
  name: string;
  limit: number;
}

const LIMIT_OF: Record<PlanLimitKind, (plan: PlanCatalogItem) => number> = {
  rotations: (p) => p.limits.linkRotations,
  groups: (p) => p.limits.linkRotationGroups,
  telegramLinkRotations: (p) => p.limits.telegramLinkRotations,
  telegramLinkRotationGroups: (p) => p.limits.telegramLinkRotationGroups,
  whatsappSessions: (p) => p.limits.whatsappSessions,
  telegramSessions: (p) => p.limits.telegramSessions,
  whatsappMonitoredGroups: (p) => p.limits.monitoredGroups,
  telegramMonitoredGroups: (p) => p.limits.telegramMonitoredGroups,
  whatsappBroadcastGroups: (p) => p.limits.broadcastGroups,
  telegramBroadcastGroups: (p) => p.limits.telegramBroadcastGroups,
  mercadoLivreTags: (p) => p.limits.mercadoLivreTags,
};

/**
 * Como o aviso de upgrade se comporta por kind. `listAll`: compara com todos os planos acima (o
 * padrão é só o próximo). `feature`: chave `?feature=` do aviso no topo da vitrine de planos.
 */
const UPSELL_CONFIG: Partial<Record<PlanLimitKind, { listAll?: boolean; feature?: string }>> = {
  mercadoLivreTags: { listAll: true, feature: 'mercadoLivreTags' },
};

/** O aviso deste kind lista todos os planos acima (ex.: etiquetas do ML no LITE → PRO e MAX). */
export const listsAllPlans = (kind: PlanLimitKind): boolean => UPSELL_CONFIG[kind]?.listAll === true;

/** Destino do CTA de planos para o kind (com `?feature=` quando o kind tem aviso próprio na vitrine). */
export function upgradePathFor(kind: PlanLimitKind): string {
  const feature = UPSELL_CONFIG[kind]?.feature;
  return feature ? `${AFFILIATE_PLANS_PATH}?feature=${feature}` : AFFILIATE_PLANS_PATH;
}

/**
 * Todos os planos da vitrine com limite maior que o atual, em ordem crescente. `[]` = já no teto.
 * Regra pura, como `nextPlanFor`.
 */
export function plansAbove(kind: PlanLimitKind, currentLimit: number): NextPlanOffer[] {
  return PLAN_CATALOG.map((plan) => ({ name: plan.name, limit: LIMIT_OF[kind](plan) })).filter((o) => o.limit > currentLimit);
}

/**
 * Menor plano da vitrine (`features/plans/catalog.ts`, em ordem crescente) que permite mais que o
 * limite atual. `null` = o tenant já está no teto: o aviso não oferece upgrade.
 * Regra pura: não consulta o plano do tenant, só compara números.
 */
export function nextPlanFor(kind: PlanLimitKind, currentLimit: number): NextPlanOffer | null {
  for (const plan of PLAN_CATALOG) {
    const limit = LIMIT_OF[kind](plan);
    if (limit > currentLimit) return { name: plan.name, limit };
  }
  return null;
}
