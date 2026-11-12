import type { HuntCandidate } from '../../hunter/HuntCandidate';

/** Candidato de teste (valores parecidos com os da sonda). Usado só por testes. */
export function huntCandidate(patch: Partial<HuntCandidate> = {}): HuntCandidate {
  return {
    goodsId: '533885353',
    skc: 'sz2407221234567890',
    activityId: '20',
    title: 'Vestido Midi Floral',
    imageUrl: 'https://img.ltwebstatic.com/v4/j/spmp/x.jpg',
    priceCents: 5990,
    retailPriceCents: 9990,
    discountPct: 40,
    commissionNewPct: 15,
    commissionNewCents: 899,
    commissionReturningPct: 8,
    commissionReturningCents: 479,
    extraCommissionCents: 0,
    sales: 300,
    reviews: 1000,
    rating: 4.8,
    rank: 3,
    categoryId: '4436',
    campaignEndsAt: null,
    ...patch,
  };
}
