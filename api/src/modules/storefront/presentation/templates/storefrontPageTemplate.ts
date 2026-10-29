import type { IStorefrontPageTemplate } from '../../domain/contracts/IStorefrontPageTemplate';
import { unavailablePage } from '../../../link-rotation/presentation/templates/publicLinkPages';
import {
  renderStorefrontPage,
  storefrontComingSoonPage,
  storefrontPausedPage,
  styleHashOf,
} from './renderStorefrontPage';

export interface StorefrontPageOrigins {
  /** `S3_PUBLIC_URL`: única origem de imagem aceita. */
  mediaOrigin: string | null;
  /** `PANEL_URL`: arquivos de marca (`/assets/brand/`), como o rodízio. */
  assetBaseUrl: string | null;
}

/** Liga a porta `IStorefrontPageTemplate` às funções puras do template, com as origens fixas. */
export function createStorefrontPageTemplate(origins: StorefrontPageOrigins): IStorefrontPageTemplate {
  return {
    page: (model, opts) => renderStorefrontPage(model, { ...origins, ...opts }),
    comingSoon: storefrontComingSoonPage,
    paused: storefrontPausedPage,
    unavailable: () => {
      const html = unavailablePage();
      return { html, styleHash: styleHashOf(html) };
    },
  };
}
