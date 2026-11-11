import { describe, expect, it } from 'vitest';
import { OFFER_STORY_ERROR_CODES, PRODUCT_FORM_DEFAULTS, mapRenderError, parseDiscount, toRenderInput, validateProductForm, type ProductFormState } from './productForm';
import { offerStoryStrings as t } from './strings';
import { affiliateLinkStrings as al } from '@/features/affiliateLinks/strings';

const URL_OK = 'https://www.mercadolivre.com.br/produto/p/MLB123';
const form = (patch: Partial<ProductFormState> = {}): ProductFormState => ({ ...PRODUCT_FORM_DEFAULTS, url: URL_OK, ...patch });

describe('validateProductForm', () => {
  it('link obrigatório e http(s)', () => {
    expect(validateProductForm(form({ url: '  ' })).url).toBe(t.validation.urlRequired);
    expect(validateProductForm(form({ url: 'shopee' })).url).toBe(t.validation.urlInvalid);
    expect(validateProductForm(form({ url: 'ftp://x.com/a' })).url).toBe(t.validation.urlInvalid);
    expect(validateProductForm(form())).toEqual({});
  });

  it('cupom desligado ignora código e desconto', () => {
    expect(validateProductForm(form({ couponEnabled: false, code: '!!!', discount: '99' }))).toEqual({});
  });

  it('código: obrigatório, ≤ 20, letras/números/_ . - e espaço', () => {
    expect(validateProductForm(form({ couponEnabled: true })).code).toBe(t.validation.codeRequired);
    expect(validateProductForm(form({ couponEnabled: true, code: 'A'.repeat(21) })).code).toBe(t.validation.codeTooLong);
    expect(validateProductForm(form({ couponEnabled: true, code: 'OFF#10' })).code).toBe(t.validation.codeInvalid);
    expect(validateProductForm(form({ couponEnabled: true, code: 'PROMO_10.Ç-X 2' }))).toEqual({});
  });

  it('desconto opcional, inteiro 1–90', () => {
    expect(parseDiscount('')).toBeNull();
    expect(parseDiscount('1')).toBe(1);
    expect(parseDiscount('90')).toBe(90);
    for (const bad of ['0', '91', '1.5', '-3', 'x']) expect(parseDiscount(bad)).toBeUndefined();
    expect(validateProductForm(form({ couponEnabled: true, code: 'X', discount: '95' })).discount).toBe(t.validation.discountInvalid);
  });
});

describe('toRenderInput', () => {
  it('sem cupom não envia coupon; com cupom envia código aparado e desconto numérico', () => {
    expect(toRenderInput('flash-night', form({ url: ` ${URL_OK} ` }))).toEqual({ templateId: 'flash-night', url: URL_OK });
    expect(toRenderInput('x', form({ couponEnabled: true, code: ' OFF10 ', discount: '10' })).coupon).toEqual({ code: 'OFF10', discountPercent: 10 });
    expect(toRenderInput('x', form({ couponEnabled: true, code: 'OFF10' })).coupon).toEqual({ code: 'OFF10' });
  });
});

describe('mapRenderError', () => {
  it('erros de link vão para o campo do link', () => {
    for (const code of ['OFFER_URL_UNSUPPORTED', 'OFFER_PRODUCT_NOT_FOUND', 'OFFER_STORY_PRODUCT_INCOMPLETE'] as const) {
      expect(mapRenderError({ status: 422, code })).toEqual({ field: 'url', message: t.errors[code], backToTemplates: false });
    }
  });

  it('códigos removidos da API não estão mais na lista e viram genérico', () => {
    for (const code of ['OFFER_LINK_NOT_OWNED', 'OFFER_LINK_NOT_AFFILIATE']) {
      expect(OFFER_STORY_ERROR_CODES as readonly string[]).not.toContain(code);
      expect(mapRenderError({ status: 422, code })).toEqual({ field: null, message: t.errors.generic, backToTemplates: false });
    }
  });

  it('loja sem credencial: texto do módulo comum no link e botão de conectar com código e meta', () => {
    const meta = { provider: 'SHOPEE' };
    expect(mapRenderError({ status: 422, code: 'AFFILIATE_CREDENTIAL_REQUIRED', meta })).toEqual({
      field: 'url', message: al.errors.credentialRequired('SHOPEE'), backToTemplates: false,
      action: 'credentials', connect: { code: 'AFFILIATE_CREDENTIAL_REQUIRED', meta },
    });
    expect(mapRenderError({ status: 422, code: 'OFFER_LINK_REBUILD_FAILED', meta: { provider: 'MERCADO_LIVRE' } }))
      .toEqual({ field: 'url', message: al.errors.rebuildFailed('MERCADO_LIVRE'), backToTemplates: false });
  });

  it('Shein fora do plano e aceite pendente vão para o campo do link', () => {
    expect(mapRenderError({ code: 'PLAN_FEATURE_UNAVAILABLE', meta: { key: 'marketplace_shein_enabled' } })).toEqual({ field: 'url', message: t.errors.sheinUnavailable, backToTemplates: false });
    expect(mapRenderError({ code: 'MARKETPLACE_RISK_NOT_ACCEPTED' })).toEqual({
      field: 'url', message: al.errors.riskNotAccepted, backToTemplates: false, action: 'credentials', connect: { code: 'MARKETPLACE_RISK_NOT_ACCEPTED' },
    });
  });

  it('etiqueta do ML: não vinculada → credenciais; sem vaga → planos (no maior plano, credenciais)', () => {
    expect(mapRenderError({ status: 422, code: 'AFFILIATE_IDENTIFIER_NOT_LINKED', meta: { provider: 'MERCADO_LIVRE', limit: 2, used: 1 } }))
      .toEqual({ field: 'url', message: t.errors.AFFILIATE_IDENTIFIER_NOT_LINKED, backToTemplates: false, action: 'credentials' });
    const limit = (n?: number) => ({ status: 403, code: 'PLAN_LIMIT_REACHED', meta: { key: 'mercado_livre_affiliate_tags', ...(n != null ? { limit: n } : {}) } });
    expect(mapRenderError(limit(1))).toEqual({ field: 'url', message: t.errors.mercadoLivreTagLimit(1, true), backToTemplates: false, action: 'plans' });
    expect(mapRenderError(limit()).action).toBe('plans');
    expect(mapRenderError(limit(10))).toEqual({ field: 'url', message: t.errors.mercadoLivreTagLimit(10, false), backToTemplates: false, action: 'credentials' });
    for (const err of [limit(1), { code: 'AFFILIATE_IDENTIFIER_NOT_LINKED' }]) expect(mapRenderError(err).message).not.toBe(t.errors.generic);
  });

  it('OFFER_INVALID_INPUT com field coupon vai para o código', () => {
    expect(mapRenderError({ code: 'OFFER_INVALID_INPUT', field: 'coupon' }).field).toBe('code');
    expect(mapRenderError({ code: 'OFFER_INVALID_INPUT', field: 'coupon.discountPercent' }).field).toBe('discount');
  });

  it('RATE_LIMITED usa os segundos quando vierem; desconhecido vira genérico', () => {
    expect(mapRenderError({ code: 'RATE_LIMITED', meta: { retryAfterSeconds: 30 } }).message).toBe(t.errors.rateLimitedSeconds(30));
    expect(mapRenderError({ code: 'RATE_LIMITED' }).message).toBe(t.errors.RATE_LIMITED);
    expect(mapRenderError({ code: 'BOOM', message: 'raw' } as never)).toEqual({ field: null, message: t.errors.generic, backToTemplates: false });
    expect(mapRenderError(null).message).toBe(t.errors.generic);
  });

  it('credencial/API de afiliado vai para o link; limite, loja fora e gerador ocupado são aviso geral', () => {
    expect(mapRenderError({ status: 422, code: 'AFFILIATE_API_ACCESS_DENIED' })).toEqual({ field: 'url', message: al.errors.apiAccessDenied, backToTemplates: false });
    const meta = { provider: 'SHOPEE' };
    expect(mapRenderError({ status: 422, code: 'AFFILIATE_CREDENTIAL_REJECTED', meta })).toEqual({
      field: 'url', message: al.errors.credentialRejected('SHOPEE'), backToTemplates: false, action: 'credentials', connect: { code: 'AFFILIATE_CREDENTIAL_REJECTED', meta },
    });
    for (const [status, code] of [[429, 'AFFILIATE_API_RATE_LIMITED'], [503, 'AFFILIATE_API_UNAVAILABLE']] as const) {
      expect(mapRenderError({ status, code, meta })).toEqual({ field: null, message: al.errors.storeUnavailable('SHOPEE'), backToTemplates: false });
    }
    expect(mapRenderError({ status: 503, code: 'MEDIA_PROCESSOR_UNAVAILABLE' })).toEqual({ field: null, message: t.errors.MEDIA_PROCESSOR_UNAVAILABLE, backToTemplates: false });
  });

  it('template inexistente volta ao passo 1', () => {
    expect(mapRenderError({ code: 'OFFER_STORY_TEMPLATE_NOT_FOUND' }).backToTemplates).toBe(true);
  });
});
