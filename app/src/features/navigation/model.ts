import type { LucideIcon } from 'lucide-react';
import {
  BadgePercent, Bookmark, Send, Bot, Crown, EyeOff, Flame, Globe, LayoutDashboard, Link2,
  KeyRound, MessagesSquare, Receipt, SlidersHorizontal, Server, Settings, Signpost, Tag, UserRoundPlus, Users, Workflow,
} from 'lucide-react';
import { MODULE_ICONS } from './icons';
import { plansStrings } from '@/features/plans/strings';
import { privacyStrings } from '@/features/privacy/strings';
import { linkRotationStrings } from '@/features/linkRotation/strings';
import { aiStrings } from '@/features/ai/strings';
import { linkDomainsAdminStrings } from '@/features/linkDomainsAdmin/strings';
import { workersAdminStrings } from '@/features/workersAdmin/strings';
import { infraCostsStrings } from '@/features/infraCosts/strings';
import { redirectLinksStrings } from '@/features/redirectLinks/strings';
import { navigationStrings as s } from './strings';

/**
 * Modelo puro do menu lateral: só dados (ícone como componente Lucide, nunca JSX).
 * O JSX com `AppIcon` fica nos componentes de `app/nav/`.
 */
export interface NavLink {
  key: string;
  label: string;
  path: string;
  icon: LucideIcon;
  /** Selo após o rótulo (ex.: plano exigido). */
  badge?: string;
  /** Prefixo de rota que também marca o item como ativo (ex.: `/settings`). */
  matchPrefix?: string;
  superAdminOnly?: boolean;
}

export interface NavAction {
  key: string;
  label: string;
  action: 'privacy';
  icon: LucideIcon;
}

export type NavProductStatus = 'available' | 'soon';

export interface NavProduct {
  key: string;
  label: string;
  tagline: string;
  icon: LucideIcon;
  status: NavProductStatus;
  children: NavLink[];
}

export interface NavigationModel {
  top: NavLink[];
  products: NavProduct[];
  platform: NavLink[];
  bottom: (NavLink | NavAction)[];
}

export interface BuildNavigationInput {
  isSuperAdmin: boolean;
}

export interface ActiveEntry {
  link: NavLink;
  product?: NavProduct;
}

export function isNavAction(entry: NavLink | NavAction): entry is NavAction {
  return 'action' in entry;
}

export function linkMatches(link: NavLink, pathname: string): boolean {
  if (pathname === link.path) return true;
  if (!link.matchPrefix) return false;
  return pathname === link.matchPrefix || pathname.startsWith(`${link.matchPrefix}/`);
}

/** Credenciais de afiliado moram no produto Afiliados (antes em Configurações; rota antiga redireciona). */
export const AFFILIATE_CREDENTIALS_PATH = '/affiliates/credentials';
/** Planos são por produto: a vitrine atual é a do Afiliados (rota antiga `/plans` redireciona). */
export const AFFILIATE_PLANS_PATH = '/affiliates/plans';

export function buildNavigation({ isSuperAdmin }: BuildNavigationInput): NavigationModel {
  const onlyAllowed = (links: NavLink[]) => links.filter((l) => !l.superAdminOnly || isSuperAdmin);

  const affiliates: NavProduct = {
    key: 'affiliates',
    label: s.products.affiliates.label,
    tagline: s.products.affiliates.tagline,
    icon: BadgePercent,
    status: 'available',
    children: [
      { key: 'offers', label: s.links.offers, path: '/offers', icon: Tag },
      { key: 'monitoring', label: s.links.monitoring, path: '/monitoring', icon: MODULE_ICONS.monitoring },
      { key: 'broadcast-groups', label: s.links.broadcastGroups, path: '/broadcast-groups', icon: Send },
      { key: 'link-rotation', label: linkRotationStrings.menuLabel, path: '/link-rotation', icon: Link2 },
      { key: 'storefront', label: s.links.storefront, path: '/storefront', icon: MODULE_ICONS.storefront, badge: plansStrings.badgeProfessional },
      { key: 'offer-story', label: s.links.offerStory, path: '/offer-story', icon: MODULE_ICONS.offerStory, badge: plansStrings.badgeBusiness },
      { key: 'affiliate-credentials', label: s.links.affiliateCredentials, path: AFFILIATE_CREDENTIALS_PATH, icon: KeyRound },
      { key: 'affiliate-plans', label: plansStrings.menuLabel, path: AFFILIATE_PLANS_PATH, icon: Crown },
    ],
  };

  // Chat ainda não é produto dos planos: só super admin vê (a rota também redireciona os demais).
  const crmChildren = onlyAllowed([
    { key: 'chat', label: s.links.chat, path: '/chat', icon: MessagesSquare, superAdminOnly: true },
  ]);
  const crmAutomation: NavProduct = {
    key: 'crm-automation',
    label: s.products.crmAutomation.label,
    tagline: s.products.crmAutomation.tagline,
    icon: Workflow,
    status: crmChildren.length > 0 ? 'available' : 'soon',
    children: crmChildren,
  };

  const soon = (key: string, copy: { label: string; tagline: string }, icon: LucideIcon): NavProduct => ({
    key, label: copy.label, tagline: copy.tagline, icon, status: 'soon', children: [],
  });

  return {
    top: [{ key: 'dashboard', label: s.dashboard, path: '/dashboard', icon: LayoutDashboard }],
    products: [
      affiliates,
      crmAutomation,
      soon('group-manager', s.products.groupManager, Users),
      soon('saver', s.products.saver, Bookmark),
      soon('chip-warmer', s.products.chipWarmer, Flame),
      soon('group-filler', s.products.groupFiller, UserRoundPlus),
    ],
    platform: isSuperAdmin
      ? [
          { key: 'admin-ai', label: aiStrings.admin.navLabel, path: '/admin/ai', icon: Bot },
          { key: 'admin-link-domains', label: linkDomainsAdminStrings.navLabel, path: '/admin/link-domains', icon: Globe },
          { key: 'admin-workers', label: workersAdminStrings.navLabel, path: '/admin/workers', icon: Server, matchPrefix: '/admin/workers' },
          { key: 'admin-costs', label: infraCostsStrings.navLabel, path: '/admin/costs', icon: Receipt, matchPrefix: '/admin/costs' },
          { key: 'admin-redirect-links', label: redirectLinksStrings.navLabel, path: '/admin/redirect-links', icon: Signpost },
          { key: 'admin-plan-entitlements', label: s.links.planEntitlements, path: '/admin/plan-entitlements', icon: SlidersHorizontal },
        ]
      : [],
    bottom: [
      { key: 'privacy', label: privacyStrings.menuLabel, action: 'privacy', icon: EyeOff },
      { key: 'settings', label: s.links.settings, path: '/settings/sessions', icon: Settings, matchPrefix: '/settings' },
    ],
  };
}

/** Link ativo para a rota (e o produto que o contém, quando for filho). Puro, sem React. */
export function findActiveEntry(model: NavigationModel, pathname: string): ActiveEntry | undefined {
  for (const product of model.products) {
    const link = product.children.find((c) => linkMatches(c, pathname));
    if (link) return { link, product };
  }
  const flat = [...model.top, ...model.platform, ...model.bottom.filter((e): e is NavLink => !isNavAction(e))];
  const link = flat.find((l) => linkMatches(l, pathname));
  return link ? { link } : undefined;
}
