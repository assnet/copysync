import { PLAN_CATALOG, type PlanCatalogItem } from '@/features/plans/catalog';

/**
 * Limite de plano que pode acionar o aviso de upgrade: rodízios e grupos por link (rodízio de links;
 * `rotations`/`groups` = WhatsApp, `telegramLinkRotations`/`telegramLinkRotationGroups` = Telegram),
 * sessões por canal (tela de sessões) e grupos monitorados/de disparo por canal (Monitoramento e
 * Gerador de ofertas).
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
  | 'telegramBroadcastGroups';

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
};

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
