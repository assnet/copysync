import { describe, expect, it } from 'vitest';
import { ListOfferStoryTemplatesUseCase } from './ListOfferStoryTemplatesUseCase';
import { RenderOfferStoryUseCase, type RenderOfferStoryInput } from './RenderOfferStoryUseCase';
import { makeOfferStoryDeps, makeResolved, TENANT } from './offerStoryTestFakes';
import { OFFER_STORY_TEMPLATES } from '../../domain/offerStoryTemplates';
import { OFFER_STORY_HEADLINE_AI_PURPOSE } from '../../domain/offerStoryRules';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import { AppError } from '../../../../shared/errors/AppError';
import { OfferLinkNotOwnedError } from '../../../../shared/errors/internal/OfferErrors';
import { AiNotConfiguredError } from '../../../../shared/errors/internal/AiErrors';

const TEMPLATE = OFFER_STORY_TEMPLATES[0].id;
const base: RenderOfferStoryInput = { tenantId: TENANT, templateId: TEMPLATE, url: 'https://meli.la/abc' };

function setup() {
  const { deps, fakes } = makeOfferStoryDeps();
  return { fakes, render: new RenderOfferStoryUseCase(deps), list: new ListOfferStoryTemplatesUseCase(deps) };
}

async function code(p: Promise<unknown>) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  return { code: (err as AppError).code, status: (err as AppError).statusCode, meta: (err as AppError).meta };
}

describe('gate do plano', () => {
  it.each([[false], [undefined], ['true']])('offer_story_enabled = %j → 403 nas duas rotas, sem extrair', async (value) => {
    const { fakes, render, list } = setup();
    fakes.entitlements.values = value === undefined ? {} : { [ENTITLEMENT_KEYS.OFFER_STORY_ENABLED]: value };
    for (const p of [list.execute({ tenantId: TENANT }), render.execute(base)]) {
      expect(await code(p)).toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE', status: 403 });
    }
    expect(fakes.resolveProduct.calls).toHaveLength(0);
  });

  it('lista templates na ordem do catálogo, só id e nome', async () => {
    const { list } = setup();
    const out = await list.execute({ tenantId: TENANT });
    expect(out.templates).toEqual(OFFER_STORY_TEMPLATES.map(({ id, name }) => ({ id, name })));
  });
});

describe('RenderOfferStoryUseCase', () => {
  it('caminho feliz: data URL, título da IA, preço de/por, sem avisos', async () => {
    const { fakes, render } = setup();
    const out = await render.execute(base);
    expect(out).toMatchObject({
      image: `data:image/jpeg;base64,${Buffer.from('jpeg-bytes').toString('base64')}`,
      width: 1080, height: 1920, templateId: TEMPLATE, headline: 'Fone Bluetooth XYZ Pro com cancelamento',
      provider: 'MERCADO_LIVRE', affiliateUrl: 'https://meli.la/abc', attributionVerified: true,
      price: { fromCents: 15000, toCents: 10000 }, coupon: null, warnings: [],
    });
    expect(fakes.resolveProduct.calls).toEqual([[TENANT, 'https://meli.la/abc']]);
    expect(fakes.imageFetcher.calls).toEqual(['https://img.example/p.jpg']);
    expect(fakes.ai.calls[0]).toMatchObject({ tenantId: TENANT, purpose: OFFER_STORY_HEADLINE_AI_PURPOSE, maxOutputTokens: 80 });
    expect(fakes.ai.calls[0].prompt).toBe(makeResolved().product.title);
    expect(fakes.renderer.calls[0]).toMatchObject({ headline: out.headline, productImage: Buffer.from('jpg'), coupon: null });
    expect(fakes.renderer.calls[0].template.id).toBe(TEMPLATE);
  });

  it('template inexistente → 400 antes de extrair', async () => {
    const { fakes, render } = setup();
    expect(await code(render.execute({ ...base, templateId: 'nope' }))).toMatchObject({ code: 'OFFER_STORY_TEMPLATE_NOT_FOUND', status: 400 });
    expect(fakes.resolveProduct.calls).toHaveLength(0);
  });

  it.each([
    ['só espaços', '   '],
    ['maior que 20', 'A'.repeat(21)],
    ['caractere inválido', 'DESC%10'],
    ['maior que 40 (teto do gerador)', 'B'.repeat(41)],
  ])('cupom %s → 422 OFFER_INVALID_INPUT (coupon)', async (_l, codeValue) => {
    const { fakes, render } = setup();
    const err = await code(render.execute({ ...base, coupon: { code: codeValue } }));
    expect(err).toMatchObject({ code: 'OFFER_INVALID_INPUT', status: 422, meta: { field: 'coupon' } });
    expect(fakes.resolveProduct.calls).toHaveLength(0);
  });

  it('cupom com desconto: código aparado, "por" com desconto, "de" = original', async () => {
    const { fakes, render } = setup();
    const out = await render.execute({ ...base, coupon: { code: ' PROMO10 ', discountPercent: 10 } });
    expect(out.coupon).toEqual({ code: 'PROMO10', discountPercent: 10 });
    expect(out.price).toEqual({ fromCents: 15000, toCents: 9000 });
    expect(fakes.renderer.calls[0].coupon).toEqual({ code: 'PROMO10', discountPercent: 10 });
  });

  it('cupom sem desconto: discountPercent null e preço inalterado', async () => {
    const { render } = setup();
    const out = await render.execute({ ...base, coupon: { code: 'FRETE' } });
    expect(out.coupon).toEqual({ code: 'FRETE', discountPercent: null });
    expect(out.price).toEqual({ fromCents: 15000, toCents: 10000 });
  });

  it('erro OFFER_* da extração sobe como está', async () => {
    const { fakes, render } = setup();
    fakes.resolveProduct.error = new OfferLinkNotOwnedError('MERCADO_LIVRE');
    expect(await code(render.execute(base))).toMatchObject({ code: 'OFFER_LINK_NOT_OWNED', status: 422 });
  });

  it.each([[null], ['   ']])('título %j → 422 OFFER_STORY_PRODUCT_INCOMPLETE, sem render', async (title) => {
    const { fakes, render } = setup();
    fakes.resolveProduct.result = makeResolved({ product: { ...makeResolved().product, title } });
    expect(await code(render.execute(base))).toMatchObject({ code: 'OFFER_STORY_PRODUCT_INCOMPLETE', status: 422 });
    expect(fakes.renderer.calls).toHaveLength(0);
  });

  it('foto não baixa → NO_IMAGE, arte gerada sem foto', async () => {
    const { fakes, render } = setup();
    fakes.imageFetcher.result = null;
    const out = await render.execute(base);
    expect(out.warnings).toEqual(['NO_IMAGE']);
    expect(fakes.renderer.calls[0].productImage).toBeNull();
  });

  it('produto sem URL de foto → NO_IMAGE sem chamar o fetcher', async () => {
    const { fakes, render } = setup();
    fakes.resolveProduct.result = makeResolved({ product: { ...makeResolved().product, imageSourceUrl: null } });
    expect((await render.execute(base)).warnings).toEqual(['NO_IMAGE']);
    expect(fakes.imageFetcher.calls).toHaveLength(0);
  });

  it('foto baixada que o renderer não abre → NO_IMAGE', async () => {
    const { fakes, render } = setup();
    fakes.renderer.imageDropped = true;
    expect((await render.execute(base)).warnings).toEqual(['NO_IMAGE']);
  });

  it.each([
    ['erro AI_*', (f: ReturnType<typeof setup>['fakes']) => { f.ai.error = new AiNotConfiguredError(); }],
    ['erro qualquer', (f: ReturnType<typeof setup>['fakes']) => { f.ai.error = new Error('boom'); }],
    ['resposta com preço', (f: ReturnType<typeof setup>['fakes']) => { f.ai.text = 'Fone por R$ 99'; }],
    ['resposta vazia', (f: ReturnType<typeof setup>['fakes']) => { f.ai.text = '  '; }],
    ['timeout', (f: ReturnType<typeof setup>['fakes']) => { f.ai.hang = true; }],
  ])('IA %s → título original + AI_FALLBACK', async (_l, arrange) => {
    const { fakes, render } = setup();
    arrange(fakes);
    const out = await render.execute(base);
    expect(out.headline).toBe(makeResolved().product.title);
    expect(out.warnings).toEqual(['AI_FALLBACK']);
    expect(fakes.renderer.calls).toHaveLength(1);
  });

  it('preço nulo → NO_PRICE e bloco de preço vazio, mesmo com desconto', async () => {
    const { fakes, render } = setup();
    fakes.resolveProduct.result = makeResolved({ product: { ...makeResolved().product, priceCents: null } });
    const out = await render.execute({ ...base, coupon: { code: 'X', discountPercent: 20 } });
    expect(out.price).toEqual({ fromCents: null, toCents: null });
    expect(out.warnings).toEqual(['NO_PRICE']);
  });

  it('avisos combinados saem na ordem fixa', async () => {
    const { fakes, render } = setup();
    fakes.imageFetcher.result = null;
    fakes.ai.error = new Error('x');
    fakes.resolveProduct.result = makeResolved({ product: { ...makeResolved().product, priceCents: null } });
    expect((await render.execute(base)).warnings).toEqual(['NO_IMAGE', 'NO_PRICE', 'AI_FALLBACK']);
  });

  it('erro cru do renderer → 422 MEDIA_PROCESSING_FAILED; AppError sobe como está', async () => {
    const { fakes, render } = setup();
    fakes.renderer.error = new Error('resvg panic');
    expect(await code(render.execute(base))).toMatchObject({ code: 'MEDIA_PROCESSING_FAILED', status: 422 });
    fakes.renderer.error = new AppError('MEDIA_PROCESSOR_UNAVAILABLE', 'x', 503);
    expect(await code(render.execute(base))).toMatchObject({ code: 'MEDIA_PROCESSOR_UNAVAILABLE', status: 503 });
  });
});
