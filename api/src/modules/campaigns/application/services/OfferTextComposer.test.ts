import { describe, expect, it, vi } from 'vitest';
import { AI_PLAN_UNAVAILABLE, OfferTextComposer } from './OfferTextComposer';

const input = {
  tenantId: 't1', audience: 'MOMS' as const, title: 'Fone', priceCents: 9990, originalPriceCents: null, coupon: null,
  affiliateUrl: 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=t-20',
};
const ai = () => ({ generate: vi.fn(async () => ({ text: `Texto da IA ${input.affiliateUrl}` })) });
const ents = (v: unknown) => ({ getBoolean: vi.fn(async () => (v === undefined ? null : (v as boolean))) });

describe('OfferTextComposer — plano', () => {
  it('ai_rewrite_enabled false (LITE): modelo fixo, sem chamar a IA, aiErrorCode de plano', async () => {
    const g = ai();
    const out = await new OfferTextComposer(g as never, ents(false)).compose(input);
    expect(g.generate).not.toHaveBeenCalled();
    expect(out).toMatchObject({ aiFallback: true, aiErrorCode: AI_PLAN_UNAVAILABLE });
    expect(out.text).toContain(input.affiliateUrl);
  });

  it('ausente ou true: chama a IA', async () => {
    for (const v of [undefined, true]) {
      const g = ai();
      const out = await new OfferTextComposer(g as never, ents(v)).compose(input);
      expect(g.generate).toHaveBeenCalledTimes(1);
      expect(out.aiFallback).toBe(false);
    }
  });

  it('STANDARD não consulta o plano', async () => {
    const e = ents(false);
    await new OfferTextComposer(ai() as never, e).compose({ ...input, audience: 'STANDARD' });
    expect(e.getBoolean).not.toHaveBeenCalled();
  });
});
