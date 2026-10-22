import type { SvgIconComponent } from '@mui/icons-material';
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

export interface AffiliateHighlight {
  icon: SvgIconComponent;
  text: string;
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
  publicField: AffiliateFieldSpec;
  /** Ausente quando o programa não tem chave secreta. */
  secretField?: AffiliateFieldSpec;
  /** Sessão vem da extensão do navegador (Mercado Livre). */
  usesBrowserSession: boolean;
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
