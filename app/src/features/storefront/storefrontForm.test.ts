import { describe, expect, it } from 'vitest';
import { storefrontStrings as t } from './strings';
import type { Storefront, StorefrontOverview } from './types';
import {
  SLUG_STATUSES,
  STOREFRONT_FORM_DEFAULTS,
  errorMessage,
  formFromOverview,
  isFormDirty,
  isFormValid,
  normalizeHexColor,
  slugChange,
  slugStatusView,
  toPreviewDraft,
  toSavePayload,
  validateForm,
} from './storefrontForm';

const page: Storefront = {
  id: 'p1',
  title: 'Achadinhos',
  subtitle: null,
  avatarUrl: null,
  coverUrl: null,
  colorPrimary: '#2563EB',
  colorBackground: '#F5F5F5',
  colorCard: '#FFFFFF',
  categories: ['casa'],
  status: 'ACTIVE',
  domainId: 'd1',
  slug: 'achadinhos',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const overview = (storefront: Storefront | null): StorefrontOverview => ({
  storefront,
  publicUrl: storefront ? 'https://achadinhos.ofertas.test' : null,
  offers: { drafts: [], published: [] },
  categories: [{ key: 'casa', label: 'Casa' }],
  subtitleSuggestions: [],
  domains: [
    { id: 'd1', hostname: 'ofertas.test' },
    { id: 'd2', hostname: 'outro.test' },
  ],
});

describe('formFromOverview', () => {
  it('sem página começa com cores padrão e o primeiro domínio', () => {
    expect(formFromOverview(overview(null))).toEqual({ ...STOREFRONT_FORM_DEFAULTS, domainId: 'd1' });
  });

  it('com página copia os campos salvos', () => {
    expect(formFromOverview(overview(page))).toMatchObject({ title: 'Achadinhos', subtitle: '', slug: 'achadinhos', domainId: 'd1', categories: ['casa'] });
  });

  it('página sem endereço cai no primeiro domínio', () => {
    expect(formFromOverview(overview({ ...page, domainId: null, slug: null }))).toMatchObject({ slug: '', domainId: 'd1' });
  });
});

describe('validateForm', () => {
  const ok = formFromOverview(overview(page));

  it('aceita o formulário salvo', () => {
    expect(validateForm(ok)).toEqual({});
    expect(isFormValid(ok)).toBe(true);
  });

  it('nome de 2 a 60 depois de aparar', () => {
    expect(validateForm({ ...ok, title: ' a ' }).title).toBe(t.fields.name.invalid);
    expect(validateForm({ ...ok, title: 'ab' }).title).toBeUndefined();
    expect(validateForm({ ...ok, title: 'x'.repeat(61) }).title).toBe(t.fields.name.invalid);
  });

  it('subtítulo opcional até 80', () => {
    expect(validateForm({ ...ok, subtitle: '' }).subtitle).toBeUndefined();
    expect(validateForm({ ...ok, subtitle: 'x'.repeat(81) }).subtitle).toBe(t.fields.subtitle.invalid);
  });

  it('cor só #RRGGBB', () => {
    expect(validateForm({ ...ok, colorCard: '#fff' }).colorCard).toBe(t.fields.colors.invalid);
    expect(validateForm({ ...ok, colorPrimary: 'red' }).colorPrimary).toBe(t.fields.colors.invalid);
    expect(validateForm({ ...ok, colorBackground: ' #abcdef ' }).colorBackground).toBeUndefined();
  });

  it('nome do endereço normalizado com 3 a 50 e sem hífen nas pontas', () => {
    expect(validateForm({ ...ok, slug: '' }).slug).toBe(t.slugStatus.INVALID);
    expect(validateForm({ ...ok, slug: 'ab' }).slug).toBe(t.slugStatus.INVALID);
    expect(validateForm({ ...ok, slug: 'Loja da Ana-' }).slug).toBeUndefined();
    expect(validateForm({ ...ok, domainId: '' }).domainId).toBeTruthy();
  });
});

describe('normalizeHexColor', () => {
  it('apara e põe em maiúsculo; recusa atalho e alfa', () => {
    expect(normalizeHexColor(' #a1b2c3 ')).toBe('#A1B2C3');
    expect(normalizeHexColor('#abc')).toBeNull();
    expect(normalizeHexColor('#a1b2c3ff')).toBeNull();
  });
});

describe('payloads', () => {
  it('PUT leva campos normalizados e subtítulo vazio vira null', () => {
    const form = { ...formFromOverview(overview(page)), title: '  Loja  ', slug: 'Loja da Ana-', colorCard: '#abcdef', subtitle: '  ' };
    expect(toSavePayload(form)).toEqual({
      domainId: 'd1',
      slug: 'loja-da-ana',
      title: 'Loja',
      subtitle: null,
      colorPrimary: '#2563EB',
      colorBackground: '#F5F5F5',
      colorCard: '#ABCDEF',
      categories: ['casa'],
    });
  });

  it('prévia nunca estoura o teto do schema e omite endereço vazio', () => {
    const form = { ...STOREFRONT_FORM_DEFAULTS, title: 'x'.repeat(200), subtitle: 'y'.repeat(200), colorPrimary: 'z'.repeat(40) };
    const draft = toPreviewDraft(form);
    expect(draft.title).toHaveLength(60);
    expect(draft.subtitle).toHaveLength(80);
    expect(draft.colorPrimary.length).toBeLessThanOrEqual(16);
    expect(draft).not.toHaveProperty('slug');
    expect(draft).not.toHaveProperty('domainId');
    expect(toPreviewDraft({ ...form, slug: 'Promo', domainId: 'd1' })).toMatchObject({ slug: 'promo', domainId: 'd1' });
  });
});

describe('isFormDirty e slugChange', () => {
  const ov = overview(page);
  const form = formFromOverview(ov);

  it('sem mudança não está sujo; espaço e caixa não contam', () => {
    expect(isFormDirty(form, ov)).toBe(false);
    expect(isFormDirty({ ...form, title: ' Achadinhos ', colorCard: '#ffffff' }, ov)).toBe(false);
    expect(isFormDirty({ ...form, categories: [] }, ov)).toBe(true);
  });

  it('sem página qualquer formulário conta como novo', () => {
    const empty = overview(null);
    expect(isFormDirty(formFromOverview(empty), empty)).toBe(true);
  });

  it('detecta troca de nome ou de domínio com os endereços', () => {
    expect(slugChange(form, ov)).toBeNull();
    expect(slugChange({ ...form, slug: 'Achadinhos' }, ov)).toBeNull();
    expect(slugChange({ ...form, slug: 'novo' }, ov)).toEqual({ from: 'https://achadinhos.ofertas.test', to: 'https://novo.ofertas.test' });
    expect(slugChange({ ...form, domainId: 'd2' }, ov)).toEqual({ from: 'https://achadinhos.ofertas.test', to: 'https://achadinhos.outro.test' });
    expect(slugChange(formFromOverview(overview(null)), overview(null))).toBeNull();
  });
});

describe('slugStatusView', () => {
  it.each(SLUG_STATUSES)('%s tem tom e texto', (status) => {
    const view = slugStatusView(status);
    expect(view.text).toBe(t.slugStatus[status]);
    expect(['success', 'info', 'warning', 'error']).toContain(view.tone);
  });

  it('livre e próprio são positivos; premium é aviso', () => {
    expect(slugStatusView('AVAILABLE').tone).toBe('success');
    expect(slugStatusView('OWNED').tone).toBe('success');
    expect(slugStatusView('PREMIUM').tone).toBe('warning');
    expect(slugStatusView('TAKEN').tone).toBe('error');
  });
});

describe('errorMessage', () => {
  it.each([
    'PLAN_FEATURE_UNAVAILABLE',
    'LINK_SLUG_INVALID',
    'LINK_SLUG_RESERVED',
    'LINK_SLUG_TAKEN',
    'STOREFRONT_SLUG_PREMIUM',
    'STOREFRONT_OFFER_LIMIT',
    'STOREFRONT_PUBLISHED_LIMIT',
    'STOREFRONT_NOT_FOUND',
    'STOREFRONT_ORDER_INVALID',
    'OFFER_URL_UNSUPPORTED',
    'OFFER_LINK_NOT_OWNED',
    'OFFER_LINK_NOT_AFFILIATE',
    'MEDIA_TOO_LARGE',
    'UNSUPPORTED_MEDIA_TYPE',
    'MEDIA_PROCESSING_FAILED',
    'RATE_LIMITED',
  ])('traduz %s sem cair no genérico', (code) => {
    expect(errorMessage(code)).not.toBe(t.errors.generic);
    expect(errorMessage({ code })).toBe(errorMessage(code));
  });

  it('Amazon sem tag pede o link com a tag', () => {
    expect(errorMessage('OFFER_LINK_NOT_AFFILIATE')).toMatch(/Amazon.*tag/);
  });

  it('RATE_LIMITED usa os segundos do meta', () => {
    expect(errorMessage({ code: 'RATE_LIMITED', meta: { retryAfterSeconds: 30 } })).toBe(t.errors.rateLimitedSeconds(30));
  });

  it('código desconhecido, mensagem crua ou nada viram o genérico', () => {
    expect(errorMessage({ code: 'X', message: 'stack' })).toBe(t.errors.generic);
    expect(errorMessage(null)).toBe(t.errors.generic);
    expect(errorMessage('toString')).toBe(t.errors.generic);
  });
});
