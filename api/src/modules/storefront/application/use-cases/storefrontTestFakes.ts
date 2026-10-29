// Fakes em memória da Página de Ofertas — só para testes dos use cases.
import type {
  CreateStorefrontInput,
  IStorefrontRepository,
  PublicStorefront,
  UpdateStorefrontInput,
} from '../../domain/contracts/IStorefrontRepository';
import type {
  CreateStorefrontOfferInput,
  IStorefrontOfferRepository,
  SetStorefrontOfferStatusInput,
  UpdateStorefrontOfferInput,
} from '../../domain/contracts/IStorefrontOfferRepository';
import type { IStorefrontImageProcessor, ProcessedStorefrontImage } from '../../domain/contracts/IStorefrontImageProcessor';
import type { IStorefrontMediaStore } from '../../domain/contracts/IStorefrontMediaStore';
import type { Storefront } from '../../domain/entities/Storefront';
import type { StorefrontOffer } from '../../domain/entities/StorefrontOffer';
import type { StorefrontImageKind } from '../../domain/services/storefrontRules';
import { STOREFRONT_DEFAULT_COLORS } from '../../domain/services/storefrontRules';
import { StorefrontOfferStatus, StorefrontStatus } from '../../domain/enums/StorefrontEnums';
import type { IEntitlementReader } from '../../../tenants/domain/contracts/IEntitlementReader';
import type { BeginConsumeResult, UploadSessionRecord } from '../../../media/domain/contracts/IUploadSessionStore';
import type { FetchedOfferImage, IOfferImageFetcher } from '../../../campaigns/domain/contracts/IOfferImageFetcher';
import type { ResolvedAffiliateProduct } from '../../../campaigns/application/use-cases/ResolveAffiliateProductUseCase';
import type { TenantAffiliateLink } from '../../../campaigns/application/use-cases/BuildTenantAffiliateLinkUseCase';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import { StorefrontNotFoundError } from '../../../../shared/errors/internal/StorefrontErrors';
import type { StorefrontSlugTransaction, StorefrontUploadStore, StorefrontUseCaseDeps } from './storefrontUseCaseDeps';
import type {
  IStorefrontPageTemplate,
  StorefrontTemplateModel,
  StorefrontTemplateOptions,
} from '../../domain/contracts/IStorefrontPageTemplate';
import {
  FakeDomains,
  InMemoryLinkRotationRepository,
  InMemoryPublicSlugRegistry,
  makeDomain,
} from '../../../link-rotation/application/use-cases/linkRotationTestFakes';

export const TENANT = 'tenant-1';
export const OTHER_TENANT = 'tenant-2';
export const USER = 'user-1';
export const NOW = new Date('2026-10-29T12:00:00.000Z');
export const MEDIA_URL = 'https://media.example/storefront-';
export const STOREFRONT_DOMAIN = 'dom-1';
export const STOREFRONT_HOST = 'ofertas.example';

/** Página + claim do endereço no registry (o repo em memória não deriva um do outro). */
export function seedPageWithClaim(fakes: Pick<StorefrontFakes, 'storefronts' | 'slugs'>, over: Partial<Storefront> = {}): Storefront {
  const page = fakes.storefronts.seed(over);
  if (page.address) fakes.slugs.storefronts.push({ tenantId: page.tenantId, ...page.address, ownerId: page.id });
  return page;
}

export function makeStorefront(over: Partial<Storefront> = {}): Storefront {
  return {
    id: 'sf-1', tenantId: TENANT, title: 'Minha Loja', subtitle: null, avatarUrl: null, coverUrl: null,
    ...STOREFRONT_DEFAULT_COLORS, categories: ['electronics', 'pet_shop'], status: StorefrontStatus.ACTIVE,
    address: { domainId: 'dom-1', slug: 'minhaloja' }, createdAt: NOW, updatedAt: NOW, ...over,
  };
}

export class InMemoryStorefrontRepository implements IStorefrontRepository {
  pages: Storefront[] = [];
  /** Quantas transações abertas (`fakeStorefrontSlugTransaction`). */
  txCalls = 0;
  /** Resposta da rota pública (`findPublicByAddress`), indexada por `domainId/slug`. */
  publicByAddress = new Map<string, PublicStorefront>();
  /** Próximo `update` lança (simula falha ao gravar). */
  failUpdateOnce = false;

  seed(over: Partial<Storefront> = {}): Storefront {
    const page = makeStorefront(over);
    this.pages.push(page);
    return page;
  }

  async findByTenant(tenantId: string) {
    const p = this.pages.find((x) => x.tenantId === tenantId);
    return p ? { ...p } : null;
  }
  async create(input: CreateStorefrontInput) { return this.seed({ ...input, id: `sf-${this.pages.length + 1}` }); }
  async update(tenantId: string, input: UpdateStorefrontInput) {
    if (this.failUpdateOnce) { this.failUpdateOnce = false; throw new Error('db down'); }
    const p = this.pages.find((x) => x.tenantId === tenantId);
    if (!p) throw new StorefrontNotFoundError();
    Object.assign(p, Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)));
    return { ...p };
  }
  async setStatus(tenantId: string, status: StorefrontStatus) {
    const p = this.pages.find((x) => x.tenantId === tenantId);
    if (!p) return null;
    p.status = status;
    return status;
  }
  async delete(tenantId: string) { this.pages = this.pages.filter((x) => x.tenantId !== tenantId); }
  async findPublicByAddress(domainId: string, slug: string): Promise<PublicStorefront | null> {
    return this.publicByAddress.get(`${domainId}/${slug}`) ?? null;
  }
}

export class InMemoryStorefrontOfferRepository implements IStorefrontOfferRepository {
  offers: StorefrontOffer[] = [];
  private seq = 0;

  seed(over: Partial<StorefrontOffer> = {}): StorefrontOffer {
    const o: StorefrontOffer = {
      id: `off-${++this.seq}`, tenantId: TENANT, storefrontId: 'sf-1', status: StorefrontOfferStatus.DRAFT, position: 0,
      provider: 'SHOPEE', sourceUrl: 'https://s.shopee.com.br/x', affiliateUrl: 'https://s.shopee.com.br/x',
      attributionVerified: true, title: `Oferta ${this.seq}`, priceCents: 1000, originalPriceCents: null, imageUrl: null,
      category: null, publishedAt: null, createdAt: NOW, updatedAt: NOW, ...over,
    };
    this.offers.push(o);
    return o;
  }

  private tab(tenantId: string, storefrontId: string, status: StorefrontOfferStatus) {
    return this.offers
      .filter((o) => o.tenantId === tenantId && o.storefrontId === storefrontId && o.status === status)
      .sort((a, b) => a.position - b.position);
  }
  private find(tenantId: string, id: string) {
    const o = this.offers.find((x) => x.id === id && x.tenantId === tenantId);
    if (!o) throw new StorefrontNotFoundError(id);
    return o;
  }

  async listByStorefront(tenantId: string, storefrontId: string) {
    return [...this.tab(tenantId, storefrontId, StorefrontOfferStatus.DRAFT), ...this.tab(tenantId, storefrontId, StorefrontOfferStatus.PUBLISHED)];
  }
  async listPublished(tenantId: string, storefrontId: string) { return this.tab(tenantId, storefrontId, StorefrontOfferStatus.PUBLISHED); }
  async findById(tenantId: string, id: string) {
    const o = this.offers.find((x) => x.id === id && x.tenantId === tenantId);
    return o ? { ...o } : null;
  }
  async countByStorefront(tenantId: string, storefrontId: string) {
    const all = this.offers.filter((o) => o.tenantId === tenantId && o.storefrontId === storefrontId);
    return { total: all.length, published: all.filter((o) => o.status === StorefrontOfferStatus.PUBLISHED).length };
  }
  async maxPosition(tenantId: string, storefrontId: string, status: StorefrontOfferStatus) {
    const tab = this.tab(tenantId, storefrontId, status);
    return tab.length ? Math.max(...tab.map((o) => o.position)) : null;
  }
  async listIdsByStatus(tenantId: string, storefrontId: string, status: StorefrontOfferStatus) {
    return this.tab(tenantId, storefrontId, status).map((o) => o.id);
  }
  async create(input: CreateStorefrontOfferInput) { return { ...this.seed(input) }; }
  async update(tenantId: string, id: string, input: UpdateStorefrontOfferInput) {
    const o = this.find(tenantId, id);
    Object.assign(o, Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)));
    return { ...o };
  }
  async setStatus(tenantId: string, id: string, input: SetStorefrontOfferStatusInput) {
    const o = this.find(tenantId, id);
    Object.assign(o, input);
    return { ...o };
  }
  async setPositions(tenantId: string, _storefrontId: string, orderedIds: readonly string[]) {
    orderedIds.forEach((id, i) => { this.find(tenantId, id).position = i; });
  }
  async delete(tenantId: string, id: string) {
    this.find(tenantId, id);
    this.offers = this.offers.filter((o) => o.id !== id);
  }
  async clearCategoriesNotIn(tenantId: string, storefrontId: string, keep: readonly string[]) {
    let n = 0;
    for (const o of this.offers) {
      if (o.tenantId === tenantId && o.storefrontId === storefrontId && o.category !== null && !keep.includes(o.category)) {
        o.category = null;
        n++;
      }
    }
    return n;
  }
}

export class FakeEntitlementReader implements IEntitlementReader {
  constructor(public values: Record<string, unknown> = { [ENTITLEMENT_KEYS.STOREFRONT_ENABLED]: true }) {}
  async getNumber(_tenantId: string, key: string) {
    const v = this.values[key];
    return typeof v === 'number' ? v : null;
  }
  async getBoolean(_tenantId: string, key: string) {
    const v = this.values[key];
    return typeof v === 'boolean' ? v : null;
  }
}

export class FakeImageProcessor implements IStorefrontImageProcessor {
  calls: StorefrontImageKind[] = [];
  error: Error | null = null;
  async process(input: Buffer, kind: StorefrontImageKind): Promise<ProcessedStorefrontImage> {
    this.calls.push(kind);
    if (this.error) throw this.error;
    return { buffer: Buffer.concat([Buffer.from('webp:'), input]), width: 1, height: 1 };
  }
}

export class FakeMediaStore implements IStorefrontMediaStore {
  saved: Buffer[] = [];
  removed: string[] = [];
  error: Error | null = null;
  async save(buffer: Buffer) {
    if (this.error) throw this.error;
    this.saved.push(buffer);
    return `${MEDIA_URL}${this.saved.length}.webp`;
  }
  async remove(url: string) { this.removed.push(url); }
}

export function makeUploadRecord(over: Partial<UploadSessionRecord> = {}): UploadSessionRecord {
  return {
    uploadId: 'up-1', tenantId: TENANT, userId: USER, purpose: 'media', fileName: 'foto.png', declaredMimeType: 'image/png',
    sizeBytes: 1000, chunkSizeBytes: 8 * 1024 * 1024, totalParts: 1, receivedParts: [0], state: 'CONSUMING',
    externalMessageId: null, messageId: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), ...over,
  };
}

export class FakeUploadStore implements StorefrontUploadStore {
  begin: BeginConsumeResult = { outcome: 'started', record: makeUploadRecord() };
  released: string[] = [];
  discarded: string[] = [];
  path: string | null = '/tmp/up-1.bin';
  async beginConsume() { return this.begin; }
  async releaseConsume(uploadId: string) { this.released.push(uploadId); return null; }
  async discard(uploadId: string) { this.discarded.push(uploadId); }
  binPath() { return this.path; }
}

export function makeResolved(over: Partial<ResolvedAffiliateProduct> = {}): ResolvedAffiliateProduct {
  return {
    provider: 'MERCADO_LIVRE', sourceUrl: 'https://meli.la/abc', affiliateUrl: 'https://meli.la/abc', attributionVerified: true,
    product: { productRef: 'MLB1', title: 'Fone Bluetooth', priceCents: 9990, originalPriceCents: 12990, imageSourceUrl: 'https://img.example/p.jpg' },
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

export class FakeBuildAffiliateLink {
  result: TenantAffiliateLink = { kind: 'credential_missing', provider: 'SHOPEE' };
  error: Error | null = null;
  calls: Array<[string, string]> = [];
  async execute(tenantId: string, href: string) {
    this.calls.push([tenantId, href]);
    if (this.error) throw this.error;
    return this.result;
  }
}

export class FakeImageFetcher implements IOfferImageFetcher {
  result: FetchedOfferImage | null = { buffer: Buffer.from('jpg'), mimeType: 'image/jpeg' };
  calls: string[] = [];
  async fetch(url: string) { this.calls.push(url); return this.result; }
}

/** Template que grava o que recebeu; o HTML só identifica a variante. */
export class FakePageTemplate implements IStorefrontPageTemplate {
  pages: Array<{ model: StorefrontTemplateModel; opts: StorefrontTemplateOptions }> = [];
  page(model: StorefrontTemplateModel, opts: StorefrontTemplateOptions) {
    this.pages.push({ model, opts });
    return { html: `<page>${model.title}</page>`, styleHash: 'sha256-page' };
  }
  comingSoon(title: string) { return { html: `<soon>${title}</soon>`, styleHash: 'sha256-soon' }; }
  paused(title: string) { return { html: `<paused>${title}</paused>`, styleHash: 'sha256-paused' }; }
  unavailable() { return { html: '<unavailable>', styleHash: 'sha256-unavailable' }; }
}

/** "Transação" em memória: erro restaura páginas, ofertas, claims de página e reservas. */
export function fakeStorefrontSlugTransaction(fakes: Pick<StorefrontFakes, 'storefronts' | 'offers' | 'slugs' | 'rotations'>): StorefrontSlugTransaction {
  return async (fn) => {
    const { storefronts, offers, slugs, rotations } = fakes;
    const snap = {
      pages: storefronts.pages.map((p) => ({ ...p })),
      offers: offers.offers.map((o) => ({ ...o })),
      claims: slugs.storefronts.map((c) => ({ ...c })),
      reservations: rotations.reservations.map((r) => ({ ...r })),
    };
    fakes.storefronts.txCalls++;
    try {
      return await fn({ slugs, storefronts, offers });
    } catch (err) {
      storefronts.pages = snap.pages;
      offers.offers = snap.offers;
      slugs.storefronts = snap.claims;
      rotations.reservations = snap.reservations;
      throw err;
    }
  };
}

export interface StorefrontFakes {
  storefronts: InMemoryStorefrontRepository;
  offers: InMemoryStorefrontOfferRepository;
  entitlements: FakeEntitlementReader;
  images: FakeImageProcessor;
  media: FakeMediaStore;
  uploads: FakeUploadStore;
  resolveProduct: FakeResolveProduct;
  buildAffiliateLink: FakeBuildAffiliateLink;
  imageFetcher: FakeImageFetcher;
  files: Map<string, Buffer>;
  domains: FakeDomains;
  rotations: InMemoryLinkRotationRepository;
  slugs: InMemoryPublicSlugRegistry;
  template: FakePageTemplate;
}

/** Deps completas com fakes; cada teste usa o subconjunto do seu use case. */
export function makeStorefrontDeps(): { deps: Required<StorefrontUseCaseDeps>; fakes: StorefrontFakes } {
  const files = new Map<string, Buffer>([['/tmp/up-1.bin', Buffer.from('png')]]);
  const domains = new FakeDomains([makeDomain({ id: STOREFRONT_DOMAIN, hostname: STOREFRONT_HOST })]);
  const rotations = new InMemoryLinkRotationRepository();
  const slugs = new InMemoryPublicSlugRegistry(rotations, domains, NOW);
  const fakes: StorefrontFakes = {
    storefronts: new InMemoryStorefrontRepository(), offers: new InMemoryStorefrontOfferRepository(),
    entitlements: new FakeEntitlementReader(), images: new FakeImageProcessor(), media: new FakeMediaStore(),
    uploads: new FakeUploadStore(), resolveProduct: new FakeResolveProduct(), buildAffiliateLink: new FakeBuildAffiliateLink(),
    imageFetcher: new FakeImageFetcher(), files, domains, rotations, slugs, template: new FakePageTemplate(),
  };
  const deps: Required<StorefrontUseCaseDeps> = {
    ...fakes,
    runInSlugTransaction: fakeStorefrontSlugTransaction(fakes),
    readFile: async (path) => {
      const f = files.get(path);
      if (!f) throw new Error('ENOENT');
      return f;
    },
    now: () => NOW,
  };
  return { deps, fakes };
}
