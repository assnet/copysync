import { describe, it, expect } from 'vitest';
import { createStorefrontPageTemplate } from './storefrontPageTemplate';
import { publicPageCsp } from '../../../link-rotation/presentation/templates/publicLinkLayout';

const template = createStorefrontPageTemplate({ mediaOrigin: 'https://media.exemplo', assetBaseUrl: 'https://app.exemplo' });
const model = {
  title: 'Achados', subtitle: null, avatarUrl: 'https://media.exemplo/storefront-a.webp', coverUrl: 'https://outra.exemplo/c.webp',
  colors: { primary: '#000000', background: '#FFFFFF', card: '#FFFFFF' }, categories: [], offers: [], publicUrl: 'https://a.exemplo',
};

describe('createStorefrontPageTemplate', () => {
  it('page usa as origens fixas: mídia só do armazenamento, marca do painel', () => {
    const { html } = template.page(model, { isPreview: false });
    expect(html).toContain('https://media.exemplo/storefront-a.webp');
    expect(html).not.toContain('outra.exemplo');
    expect(html).toContain('https://app.exemplo/assets/brand/');
  });

  it('unavailable: página do rodízio com o hash que a CSP do rodízio libera', () => {
    const { html, styleHash } = template.unavailable();
    expect(html).toContain('<style>');
    expect(publicPageCsp()).toContain(`'${styleHash}'`);
  });
});
