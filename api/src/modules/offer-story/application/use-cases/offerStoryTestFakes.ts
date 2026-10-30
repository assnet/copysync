// Fakes em memória do Story de Oferta — só para testes dos use cases.
import type { IEntitlementReader } from '../../../tenants/domain/contracts/IEntitlementReader';
import type { FetchedOfferImage, IOfferImageFetcher } from '../../../campaigns/domain/contracts/IOfferImageFetcher';
import type { ResolvedAffiliateProduct } from '../../../campaigns/application/use-cases/ResolveAffiliateProductUseCase';
import type { AiTextRequest, AiTextResult, IAiTextGenerator } from '../../../assistants/domain/contracts/IAiTextGenerator';
import type {
  IOfferStoryRenderer,
  OfferStoryRenderInput,
  RenderedOfferStory,
} from '../../domain/contracts/IOfferStoryRenderer';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import type { OfferStoryUseCaseDeps } from './offerStoryUseCaseDeps';

export const TENANT = 'tenant-1';

export class FakeEntitlementReader implements IEntitlementReader {
  constructor(public values: Record<string, unknown> = { [ENTITLEMENT_KEYS.OFFER_STORY_ENABLED]: true }) {}
  async getNumber(_tenantId: string, key: string) {
    const v = this.values[key];
    return typeof v === 'number' ? v : null;
  }
  async getBoolean(_tenantId: string, key: string) {
    const v = this.values[key];
    return typeof v === 'boolean' ? v : null;
  }
}

export function makeResolved(over: Partial<ResolvedAffiliateProduct> = {}): ResolvedAffiliateProduct {
  return {
    provider: 'MERCADO_LIVRE', sourceUrl: 'https://meli.la/abc', affiliateUrl: 'https://meli.la/abc', attributionVerified: true,
    product: {
      productRef: 'MLB1', title: 'Fone de Ouvido Bluetooth XYZ Pro com Cancelamento de Ruído e Estojo de Carga',
      priceCents: 10000, originalPriceCents: 15000, imageSourceUrl: 'https://img.example/p.jpg',
    },
    ...over,
  };
}

export class FakeResolveProduct {
  result: ResolvedAffiliateProduct = makeResolved();
  error: Error | null = null;
  calls: Array<[string, string]> = [];
  async execute(tenantId: string, url: string) {
    this.calls.push([tenantId, url]);
    if (this.error) throw this.error;
    return this.result;
  }
}

export class FakeImageFetcher implements IOfferImageFetcher {
  result: FetchedOfferImage | null = { buffer: Buffer.from('jpg'), mimeType: 'image/jpeg' };
  calls: string[] = [];
  async fetch(url: string) { this.calls.push(url); return this.result; }
}

export class FakeAiTextGenerator implements IAiTextGenerator {
  text = 'Fone Bluetooth XYZ Pro com cancelamento';
  error: Error | null = null;
  /** Nunca responde (simula IA travada → timeout). */
  hang = false;
  calls: AiTextRequest[] = [];
  async generate(input: AiTextRequest): Promise<AiTextResult> {
    this.calls.push(input);
    if (this.hang) return new Promise(() => {});
    if (this.error) throw this.error;
    return { text: this.text };
  }
}

export class FakeOfferStoryRenderer implements IOfferStoryRenderer {
  calls: OfferStoryRenderInput[] = [];
  error: Error | null = null;
  imageDropped = false;
  async render(input: OfferStoryRenderInput): Promise<RenderedOfferStory> {
    this.calls.push(input);
    if (this.error) throw this.error;
    return {
      buffer: Buffer.from('jpeg-bytes'), mimeType: 'image/jpeg',
      width: input.template.width, height: input.template.height, imageDropped: this.imageDropped,
    };
  }
}

export interface OfferStoryFakes {
  entitlements: FakeEntitlementReader;
  resolveProduct: FakeResolveProduct;
  imageFetcher: FakeImageFetcher;
  ai: FakeAiTextGenerator;
  renderer: FakeOfferStoryRenderer;
}

/** Deps completas com fakes; timeout da IA curto para o teste de IA travada. */
export function makeOfferStoryDeps(): { deps: Required<OfferStoryUseCaseDeps>; fakes: OfferStoryFakes } {
  const fakes: OfferStoryFakes = {
    entitlements: new FakeEntitlementReader(), resolveProduct: new FakeResolveProduct(),
    imageFetcher: new FakeImageFetcher(), ai: new FakeAiTextGenerator(), renderer: new FakeOfferStoryRenderer(),
  };
  return { deps: { ...fakes, aiTimeoutMs: 20 }, fakes };
}
