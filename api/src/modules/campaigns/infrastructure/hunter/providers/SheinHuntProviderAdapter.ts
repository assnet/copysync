// Adaptador Shein do Caçador de Ofertas: envolve o `SheinCatalogClient` atual atrás da porta genérica.
// `did` (código interno da Shein por categoria) não sai daqui: viaja como propriedade extra da categoria listada.
import type { IHuntProviderAdapter } from '../../../domain/contracts/hunter/IHuntProviderAdapter';
import type { OfferAffiliateCredential } from '../../../domain/contracts/IAffiliateCredentialResolver';
import type { ISheinCatalogClient, SheinCatalogCategory, SheinSession } from '../../../domain/contracts/ISheinCatalogClient';
import { HUNT_SORTS, type HuntSort } from '../../../domain/hunter/HuntCandidate';
import type {
  HuntSourceCategory, HuntSourcePage, HuntSourceQuery, HuntSourceSession, IHuntCatalogSource,
} from '../../../domain/hunter/HuntProvider';
import { SHEIN_HUNT_CAPABILITIES } from '../../../domain/services/hunter/sheinCapabilities';
import { AffiliateApiUnavailableError } from '../../../../../shared/errors/internal/OfferErrors';

/** URL do produto usada para pedir o link do tenant (nunca é buscada: a página cai em desafio). */
export const sheinHuntProductUrl = (goodsId: string) => `https://br.shein.com/product-p-${goodsId}.html`;

const isDid = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

type SheinCatalogPort = Pick<ISheinCatalogClient, 'listCategories' | 'list' | 'search'>;

/** Porta genérica sobre o cliente Shein. Faixa de comissão (`resolveCommissionBand`) não é usada pelo caçador. */
export class SheinHuntCatalogSource implements IHuntCatalogSource {
  readonly provider = 'SHEIN' as const;
  constructor(private readonly client: SheinCatalogPort) {}

  private session(s: HuntSourceSession): SheinSession {
    if (s.provider !== 'SHEIN') throw new AffiliateApiUnavailableError('SHEIN');
    return { token: s.token, memberId: s.memberId };
  }

  /** Lista da fonte (o 1º é "All", `categoryId` null). Os objetos levam `did` para o `fetchPage` (sem 2ª chamada). */
  listCategories(session: HuntSourceSession): Promise<HuntSourceCategory[]> {
    return this.client.listCategories(this.session(session));
  }

  async fetchPage(session: HuntSourceSession, query: HuntSourceQuery): Promise<HuntSourcePage> {
    const s = this.session(session);
    const did = await this.didOf(s, query.category);
    const category = query.category?.categoryId ? { categoryId: query.category.categoryId, name: query.category.name } : null;
    const sort: HuntSort = (HUNT_SORTS as readonly string[]).includes(query.options.sort ?? '')
      ? (query.options.sort as HuntSort)
      : 'RECOMMENDED';
    const base = { page: query.page, did, category, sort };
    const res = query.keyword
      ? await this.client.search(s, { ...base, keyword: query.keyword })
      : await this.client.list(s, base);
    return { items: res.items, hasNextPage: res.hasNextPage };
  }

  /** `did` da categoria vinda de `listCategories`; sem ele (chamador externo), relista e procura. */
  private async didOf(s: SheinSession, category: HuntSourceCategory | null): Promise<number> {
    const carried = (category as Partial<SheinCatalogCategory> | null)?.did;
    if (isDid(carried)) return carried;
    const wanted = category?.categoryId ?? null;
    const match = (await this.client.listCategories(s)).find((c) => c.categoryId === wanted);
    if (!match) throw new AffiliateApiUnavailableError('SHEIN');
    return match.did;
  }
}

export class SheinHuntProviderAdapter implements IHuntProviderAdapter {
  readonly provider = 'SHEIN' as const;
  readonly capabilities = SHEIN_HUNT_CAPABILITIES;
  readonly imageHosts = SHEIN_HUNT_CAPABILITIES.imageHosts;
  readonly catalog: SheinHuntCatalogSource;

  constructor(client: SheinCatalogPort) {
    this.catalog = new SheinHuntCatalogSource(client);
  }

  /** Sessão = cookie `AT` + `memberId` (identificador público). Sem `AT` = sem sessão. */
  sessionFrom(credential: OfferAffiliateCredential): HuntSourceSession | null {
    const token = credential.session?.cookies?.AT;
    if (!token) return null;
    return { provider: 'SHEIN', token, memberId: credential.publicIdentifier };
  }

  productUrl(productId: string): string | null {
    return SHEIN_HUNT_CAPABILITIES.productIdPattern.test(productId) ? sheinHuntProductUrl(productId) : null;
  }
}
