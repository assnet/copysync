import type { IAffiliateCredentialGateway } from '../../../domain/contracts/IAffiliateCredentialGateway';
import type { IEntitlementReader } from '../../../domain/contracts/IEntitlementReader';
import type { IHuntProviderAdapter, IHuntProviderRegistry } from '../../../domain/contracts/hunter/IHuntProviderAdapter';
import type { IMarketplaceRiskGate } from '../../../domain/contracts/IMarketplaceRiskGate';
import type { IOfferHuntAiSuggestionCounter } from '../../../domain/contracts/hunter/IOfferHuntAiSuggestionCounter';
import type { HuntCandidate } from '../../../domain/hunter/HuntCandidate';
import {
  isHuntProvider, type HuntCapabilities, type HuntProvider, type HuntSourceCategory, type HuntSourceOptions,
  type HuntSourceSession, type IHuntCatalogSource,
} from '../../../domain/hunter/HuntProvider';
import { HUNT_PROVIDER_PLAN_KEY } from '../../services/hunter/huntProviderGates';
import { sanitizeHuntIntent, type HuntConfigDraft } from '../../../domain/services/hunter/huntConfigPrompt';
import { HUNTER_AI_LIMITS as AL } from '../../../domain/services/hunter/hunterAiLimits';
import { scoreHuntCandidate } from '../../../domain/services/hunter/scoreHuntCandidate';
import { startOfDayInZone } from '../../../domain/services/startOfDayInZone';
import type { IHuntAiAvailability } from '../../hunter/contracts/IHuntAiAvailability';
import type { IHuntConfigSuggester } from '../../hunter/contracts/IHuntConfigSuggester';
import { ENTITLEMENT_KEYS } from '../../../../tenants/domain/entitlementKeys';
import { AppError } from '../../../../../shared/errors/AppError';
import { AiNotConfiguredError } from '../../../../../shared/errors/internal/AiErrors';
import { PlanFeatureUnavailableError } from '../../../../../shared/errors/internal/PlanErrors';
import {
  OfferHuntAiSuggestDailyLimitError, OfferHuntAiSuggestInputRequiredError, OfferHuntAiSuggestInvalidOutputError,
  OfferHuntAiSuggestProviderUnavailableError,
} from '../../../../../shared/errors/internal/OfferHuntAiErrors';
import { logger as sharedLogger } from '../../../../../shared/logger/logger';

/** Fonte aberta para uma marca: porta do catálogo + sessão já decifrada (nunca sai daqui). */
interface SourceHandle {
  catalog: IHuntCatalogSource;
  session: HuntSourceSession;
}

export interface SuggestHuntConfigInput {
  tenantId: string;
  provider: string;
  intent: string | null;
  /** "IA escolhe o produto": lê a amostra larga (D6). */
  pickProduct: boolean;
  now: Date;
}

export interface SuggestHuntConfigOutput {
  draft: HuntConfigDraft & { provider: HuntProvider };
  reasons: Record<string, string>;
  dropped: string[];
  /** A fonte foi lida (categorias reais e/ou amostra). */
  sourceUsed: boolean;
  remainingToday: number;
}

export interface SuggestHuntConfigDeps {
  entitlements: IEntitlementReader;
  riskGate: IMarketplaceRiskGate;
  ai: IHuntAiAvailability;
  registry: IHuntProviderRegistry;
  credentials: Pick<IAffiliateCredentialGateway, 'resolveState'>;
  suggester: IHuntConfigSuggester;
  counter: IOfferHuntAiSuggestionCounter;
  logger?: { warn(obj: object, msg: string): void };
}

const errorCode = (err: unknown) => (err instanceof AppError ? err.code : 'SOURCE_UNEXPECTED_ERROR');

/**
 * "Deixar a IA decidir os filtros" (AI-01..06). Portões: caçador + plano da marca sempre. A fonte (categorias e,
 * com `pickProduct`, a amostra larga) só é lida com aceite `OFFER_HUNTER` da marca e credencial; sem eles a IA
 * trabalha só com capacidades + intenção (`sourceUsed: false`, categoria null). Teto técnico 5/dia por conta
 * (reserva atômica antes de ler a fonte; devolvida se o gerador recusar sem gerar). Nada é salvo: devolve rascunho.
 */
export class SuggestHuntConfigUseCase {
  private readonly logger: { warn(obj: object, msg: string): void };

  constructor(private readonly deps: SuggestHuntConfigDeps) {
    this.logger = deps.logger ?? sharedLogger;
  }

  async execute(input: SuggestHuntConfigInput): Promise<SuggestHuntConfigOutput> {
    const { tenantId, now } = input;
    const { entitlements, registry, counter } = this.deps;
    if (!isHuntProvider(input.provider)) throw new OfferHuntAiSuggestProviderUnavailableError(String(input.provider).slice(0, 32));
    const provider = input.provider;
    const keys = [ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED, HUNT_PROVIDER_PLAN_KEY[provider]].filter((k): k is NonNullable<typeof k> => !!k);
    for (const key of keys) {
      if ((await entitlements.getBoolean(tenantId, key)) !== true) throw new PlanFeatureUnavailableError(key);
    }
    const intent = sanitizeHuntIntent(input.intent);
    if (!intent && !input.pickProduct) throw new OfferHuntAiSuggestInputRequiredError();
    let adapter: IHuntProviderAdapter;
    try {
      adapter = registry.get(provider);
    } catch {
      throw new OfferHuntAiSuggestProviderUnavailableError(provider);
    }
    const capabilities = adapter.capabilities;
    if (!(await this.deps.ai.isAvailable(tenantId).catch(() => false))) throw new AiNotConfiguredError();

    const claim = await counter.claim(tenantId, startOfDayInZone(now), AL.aiSuggestionsPerDayMax, now);
    if (claim.kind === 'DAILY_LIMIT') throw new OfferHuntAiSuggestDailyLimitError(AL.aiSuggestionsPerDayMax);

    const source = await this.readSource(tenantId, adapter, input.pickProduct, now);
    let out;
    try {
      out = await this.deps.suggester.suggest({
        tenantId, capabilities, categories: source.categories, intent, sample: source.sample,
      });
    } catch (err) {
      // O gerador recusou antes de gerar (não configurado, limite, provedor fora): a sugestão não conta
      await counter.release(tenantId, claim.id).catch(() => undefined);
      throw err;
    }
    if (!out) throw new OfferHuntAiSuggestInvalidOutputError();
    return {
      draft: { provider, ...out.draft },
      reasons: out.reasons,
      dropped: out.dropped,
      sourceUsed: source.used,
      remainingToday: Math.max(0, AL.aiSuggestionsPerDayMax - claim.used),
    };
  }

  /** Falha da fonte nunca derruba a sugestão: segue sem categorias/amostra (só código no log). */
  private async readSource(tenantId: string, adapter: IHuntProviderAdapter, pickProduct: boolean, now: Date): Promise<{
    used: boolean;
    categories: HuntSourceCategory[];
    sample: { items: HuntCandidate[]; pool: HuntCandidate[] } | null;
  }> {
    const { provider, capabilities: caps } = adapter;
    const none = { used: false, categories: [], sample: null };
    const accepted = await this.deps.riskGate.isAccepted(tenantId, provider, 'OFFER_HUNTER').catch(() => false);
    if (!accepted) return none;
    const state = await this.deps.credentials.resolveState(tenantId, provider).catch(() => null);
    const session = state?.state === 'ok' ? adapter.sessionFrom(state.cred) : null;
    if (!session) return none;
    const handle: SourceHandle = { catalog: adapter.catalog, session };

    let categories: HuntSourceCategory[] = [];
    try {
      categories = await handle.catalog.listCategories(handle.session);
    } catch (err) {
      this.logger.warn({ tenantId, provider, code: errorCode(err) }, 'offer hunt AI suggest categories unavailable');
    }
    const sample = pickProduct ? await this.readSample(tenantId, handle, caps, categories, now) : null;
    const used = categories.some((c) => !!c.categoryId) || (sample?.pool.length ?? 0) > 0;
    return { used, categories, sample: sample?.pool.length ? sample : null };
  }

  /**
   * Amostra larga (D6): até 5 consultas de 1 página (mais vendidos, ganhos extras se a marca tiver, geral e as 2
   * categorias de maior comissão média da 1ª leitura), até 90 itens sem repetir, 40 melhores pela nota. 1º erro
   * da fonte encerra as consultas (sessão recusada ou limite valem para as próximas).
   */
  private async readSample(
    tenantId: string, handle: SourceHandle, caps: HuntCapabilities, categories: HuntSourceCategory[], now: Date,
  ): Promise<{ items: HuntCandidate[]; pool: HuntCandidate[] }> {
    const has = (k: string) => (caps.sourceFilters as readonly string[]).includes(k);
    const broad: HuntSourceOptions[] = [];
    if (has('bestSellersOnly')) broad.push({ bestSellersOnly: true });
    else if (caps.sorts.includes('BEST_SELLING')) broad.push({ sort: 'BEST_SELLING' });
    if (has('extraEarningsOnly')) broad.push({ extraEarningsOnly: true });
    broad.push({});

    const pool: HuntCandidate[] = [];
    const seen = new Set<string>();
    let queries = 0;
    const fetch = async (category: HuntSourceCategory | null, options: HuntSourceOptions): Promise<boolean> => {
      if (queries >= AL.sampleQueriesMax || pool.length >= AL.samplePoolMax) return false;
      queries++;
      try {
        const page = await handle.catalog.fetchPage(handle.session, { page: 1, category, keyword: null, options });
        for (const c of page.items) {
          const key = c.productId;
          if (pool.length >= AL.samplePoolMax || seen.has(key)) continue;
          seen.add(key);
          pool.push(c);
        }
        return true;
      } catch (err) {
        this.logger.warn({ tenantId, provider: caps.provider, code: errorCode(err), queries }, 'offer hunt AI suggest sample stopped');
        return false;
      }
    };

    let ok = true;
    for (const options of broad) if (ok) ok = await fetch(null, options);
    if (ok && has('category')) {
      const real = new Map(categories.filter((c) => !!c.categoryId).map((c) => [c.categoryId as string, c]));
      const byCat = new Map<string, number[]>();
      for (const c of pool) {
        if (c.categoryId && real.has(c.categoryId)) byCat.set(c.categoryId, [...(byCat.get(c.categoryId) ?? []), c.commissionNewPct]);
      }
      const top = [...byCat.entries()]
        .map(([id, pcts]) => ({ id, avg: pcts.reduce((a, b) => a + b, 0) / pcts.length }))
        .sort((a, b) => b.avg - a.avg)
        .slice(0, AL.sampleTopCategories);
      for (const { id } of top) if (ok) ok = await fetch(real.get(id)!, {});
    }

    const items = pool
      .map((c, i) => ({ c, i, s: scoreHuntCandidate(c, now).score }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .slice(0, AL.samplePromptMax)
      .map(({ c }) => c);
    return { items, pool };
  }
}
