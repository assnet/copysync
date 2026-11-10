import type { SvgIconComponent } from '@mui/icons-material';
import type { LucideIcon } from 'lucide-react';
import { Link2, Puzzle, UserCheck } from 'lucide-react';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import VpnKeyOutlinedIcon from '@mui/icons-material/VpnKeyOutlined';
import PaidOutlinedIcon from '@mui/icons-material/PaidOutlined';
import ExtensionOutlinedIcon from '@mui/icons-material/ExtensionOutlined';
import SellOutlinedIcon from '@mui/icons-material/SellOutlined';
import KeyOffOutlinedIcon from '@mui/icons-material/KeyOffOutlined';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import type { AffiliateProvider } from '@/types/api.types';
import { settingsStrings } from './strings';

/**
 * Catálogo dos marketplaces de afiliado. As regex espelham o domínio da API
 * (`integrations/domain/services/affiliateProviderFields.ts`) e são permissivas de propósito:
 * a API é quem decide; aqui só evitamos uma ida ao servidor com valor obviamente errado.
 */
export interface AffiliateFieldSpec {
  label: string;
  helper: string;
  pattern: RegExp;
  placeholder?: string;
}

/**
 * Ícone do destaque: MUI (marketplaces antigos) ou Lucide (novos, renderizado por `AppIcon`).
 * A migração dos antigos para Lucide fica fora desta feature.
 */
export type AffiliateHighlightIcon = SvgIconComponent | LucideIcon;

export interface AffiliateHighlight {
  icon: AffiliateHighlightIcon;
  text: string;
}

/** Ícone MUI tem `muiName` (de `createSvgIcon`); Lucide não. */
export function isMuiIcon(icon: AffiliateHighlightIcon): icon is SvgIconComponent {
  return typeof (icon as { muiName?: unknown }).muiName === 'string';
}

export interface AffiliateProviderSpec {
  provider: AffiliateProvider;
  /** Nome do marketplace (terceiro), pode aparecer na tela. */
  name: string;
  description: string;
  /** Logo do marketplace em `public/assets/marketplaces/` (licenças no LICENSE.md da pasta). */
  logo: string;
  /**
   * Cor oficial da marca do marketplace (terceiro). Única cor fixa permitida na tela:
   * usada só como acento (faixa e fundo translúcido), nunca como cor de texto.
   */
  brandColor: string;
  /** O que a conexão faz, em 3 linhas curtas com ícone. */
  highlights: readonly AffiliateHighlight[];
  /** Ausente quando o ID vem da sessão (`identifierFromSession`): nada a digitar. */
  publicField?: AffiliateFieldSpec;
  /** Ausente quando o programa não tem chave secreta. */
  secretField?: AffiliateFieldSpec;
  /** Sessão vem da extensão do navegador (Mercado Livre, Shein). */
  usesBrowserSession: boolean;
  /**
   * O ID de afiliado segue a sessão (Shein): sem campo editável, e desconectar/remover usa a rota
   * da extensão (`disconnect`), nunca o DELETE genérico (a API devolve 409).
   */
  identifierFromSession?: boolean;
  /** Segmento da extensão (`/extension/marketplaces/<id>`) quando `usesBrowserSession`. */
  extensionMarketplace?: 'ml' | 'shein';
  /** Guia do diálogo: programa de afiliados (nome e painel oficial) e, se houver, link de ajuda. */
  setup?: { program: string; url: string; helpUrl?: string };
  /** Prévia do link de afiliado com o identificador digitado (só quando o formato é válido). */
  linkPreview?: (publicIdentifier: string) => string;
}

const { fields, providerDescriptions, providerHighlights: hl } = settingsStrings.affiliate;

export const AFFILIATE_PROVIDERS: readonly AffiliateProviderSpec[] = [
  {
    provider: 'SHOPEE',
    name: 'Shopee',
    description: providerDescriptions.SHOPEE,
    logo: '/assets/marketplaces/shopee.svg',
    brandColor: '#EE4D2D',
    highlights: [
      { icon: VpnKeyOutlinedIcon, text: hl.SHOPEE[0] },
      { icon: LockOutlinedIcon, text: hl.SHOPEE[1] },
      { icon: PaidOutlinedIcon, text: hl.SHOPEE[2] },
    ],
    publicField: { label: fields.shopeeAppId, helper: fields.shopeeAppIdHelp, pattern: /^\d{5,20}$/ },
    secretField: { label: fields.shopeeSecret, helper: fields.shopeeSecretHelp, pattern: /^[A-Za-z0-9]{16,128}$/ },
    usesBrowserSession: false,
    setup: {
      program: 'Shopee Afiliados',
      url: 'https://affiliate.shopee.com.br/open_api',
      helpUrl: 'https://help.shopee.com.br/portal/webform/bbce78695c364ba18c9cbceb74ec9091',
    },
  },
  {
    provider: 'MERCADO_LIVRE',
    name: 'Mercado Livre',
    description: providerDescriptions.MERCADO_LIVRE,
    logo: '/assets/marketplaces/mercado-livre.svg',
    brandColor: '#FFE600',
    highlights: [
      { icon: ExtensionOutlinedIcon, text: hl.MERCADO_LIVRE[0] },
      { icon: SellOutlinedIcon, text: hl.MERCADO_LIVRE[1] },
      { icon: KeyOffOutlinedIcon, text: hl.MERCADO_LIVRE[2] },
    ],
    publicField: {
      label: fields.mercadoLivreTag,
      helper: fields.mercadoLivreTagHelp,
      pattern: /^[A-Za-z0-9._-]{2,64}$/,
    },
    usesBrowserSession: true,
    extensionMarketplace: 'ml',
  },
  {
    provider: 'AMAZON',
    name: 'Amazon',
    description: providerDescriptions.AMAZON,
    logo: '/assets/marketplaces/amazon.svg',
    brandColor: '#FF9900',
    highlights: [
      { icon: FactCheckOutlinedIcon, text: hl.AMAZON[0] },
      { icon: KeyOffOutlinedIcon, text: hl.AMAZON[1] },
      { icon: ShareOutlinedIcon, text: hl.AMAZON[2] },
    ],
    publicField: {
      label: fields.amazonTag,
      helper: fields.amazonTagHelp,
      pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}-\d{2}$/,
      placeholder: 'minhaloja-20',
    },
    usesBrowserSession: false,
    setup: { program: 'Amazon Associados', url: 'https://associados.amazon.com.br/' },
    linkPreview: (tag) => `amazon.com.br/dp/B0XXXXXXXX?tag=${tag}`,
  },
  {
    provider: 'SHEIN',
    name: 'Shein',
    description: providerDescriptions.SHEIN,
    logo: '/assets/marketplaces/shein.svg',
    brandColor: '#000000',
    highlights: [
      { icon: Puzzle, text: hl.SHEIN[0] },
      { icon: Link2, text: hl.SHEIN[1] },
      { icon: UserCheck, text: hl.SHEIN[2] },
    ],
    usesBrowserSession: true,
    identifierFromSession: true,
    extensionMarketplace: 'shein',
  },
];

/**
 * Valida um campo após `trim`. Vazio só é erro quando `required`.
 * Devolve a mensagem de erro ou `null`.
 */
export function validateAffiliateField(field: AffiliateFieldSpec, rawValue: string, required: boolean): string | null {
  const value = rawValue.trim();
  if (!value) return required ? settingsStrings.affiliate.fieldRequired(field.label) : null;
  return field.pattern.test(value) ? null : settingsStrings.affiliate.fieldInvalid(field.label);
}
