import type { IOfferHuntRunRepository } from '../../../domain/contracts/hunter/IOfferHuntRunRepository';
import type { IOfferHuntFindRepository } from '../../../domain/contracts/hunter/IOfferHuntFindRepository';
import type { IOfferHunterSettingsRepository } from '../../../domain/contracts/hunter/IOfferHunterSettingsRepository';
import type { IOfferGeneratorConfigRepository } from '../../../domain/contracts/IOfferGeneratorConfigRepository';
import type { IHuntProviderAdapter, IHuntProviderRegistry } from '../../../domain/contracts/hunter/IHuntProviderAdapter';
import type { AffiliateCredentialState } from '../../../domain/contracts/IAffiliateCredentialGateway';
import type { IAffiliateCredentialGateway } from '../../../domain/contracts/IAffiliateCredentialGateway';
import type { IEntitlementReader } from '../../../domain/contracts/IEntitlementReader';
import type { IMarketplaceRiskGate } from '../../../domain/contracts/IMarketplaceRiskGate';
import type { IHuntAiAvailability } from '../../hunter/contracts/IHuntAiAvailability';
import { HUNT_PROVIDERS, type HuntProvider } from '../../../domain/hunter/HuntProvider';
import { huntPresetsFor, type HuntPreset, type HuntProviderPresetDefinition } from '../../../domain/services/hunter/huntPresets';
import { huntCapabilitiesView } from '../../../domain/services/hunter/huntCapabilities';
import { HUNT_PROVIDER_PLAN_KEY } from '../../services/hunter/huntProviderGates';
import { HUNTER_LIMITS } from '../../../domain/services/hunter/hunterLimits';
import { startOfDayInZone } from '../../../domain/services/startOfDayInZone';
import { ENTITLEMENT_KEYS } from '../../../../tenants/domain/entitlementKeys';
import { AffiliateCredentialRejectedError } from '../../../../../shared/errors/internal/OfferErrors';
import { logger } from '../../../../../shared/logger/logger';

// ── Uso do dia ───────────────────────────────────────────────────────────────

export interface OfferHunterUsage {
  /** Achados gravados hoje (todo achado conta, mesmo dispensado). */
  used: number;
  /** `offer_hunter_finds_per_day`; ausente = 0 (nunca ilimitado). */
  limit: number;
  remaining: number;
  /** Execuções abertas hoje (guarda técnica). */
  runsToday: number;
  runsMax: number;
  /** Reenvios de achados hoje frente ao teto técnico (`HUNTER_LIMITS.resendsPerDayMax`). */
  resendsToday: number;
  resendsMax: number;
}

export class GetOfferHunterUsageUseCase {
  constructor(private readonly deps: {
    finds: Pick<IOfferHuntFindRepository, 'countCreatedSince' | 'countResendsInDay'>;
    runs: Pick<IOfferHuntRunRepository, 'countStartedSince'>;
    entitlements: IEntitlementReader;
    now?: () => Date;
  }) {}

  async execute(tenantId: string): Promise<OfferHunterUsage> {
    const since = startOfDayInZone((this.deps.now ?? (() => new Date()))());
    const [limitRaw, used, runsToday, resendsToday] = await Promise.all([
      this.deps.entitlements.getNumber(tenantId, ENTITLEMENT_KEYS.OFFER_HUNTER_FINDS_PER_DAY),
      this.deps.finds.countCreatedSince(tenantId, since),
      this.deps.runs.countStartedSince(tenantId, since),
      this.deps.finds.countResendsInDay(tenantId, since),
    ]);
    const limit = limitRaw ?? 0;
    return {
      used, limit, remaining: Math.max(0, limit - used), runsToday, runsMax: HUNTER_LIMITS.runsPerDayMax,
      resendsToday, resendsMax: HUNTER_LIMITS.resendsPerDayMax,
    };
  }
}

// ── Opções do assistente ─────────────────────────────────────────────────────

/**
 * Estado da lista de categorias. `LOCKED` = portão anterior fechado (plano, caçador ou aceite): a fonte
 * nem é chamada. Qualquer estado ≠ `OK` devolve lista vazia; a tela não falha.
 */
export type HuntCategorySourceStatus = 'OK' | 'LOCKED' | 'NO_CREDENTIAL' | 'CREDENTIAL_REJECTED' | 'UNAVAILABLE';

export interface OfferHunterGates {
  /** Plano da marca (Shein `marketplace_shein_enabled`; ML sem chave = true). */
  plan: boolean;
  /** `offer_hunter_enabled`. */
  hunterEntitlement: boolean;
  /** Conta da marca conectada, não recusada, com sessão utilizável. */
  credential: boolean;
  /** Aviso de risco do caçador (`OFFER_HUNTER`) da marca na versão vigente. */
  riskAccepted: boolean;
  aiAvailable: boolean;
  destination: boolean;
}

export interface OfferHunterOptions {
  provider: HuntProvider;
  capabilities: ReturnType<typeof huntCapabilitiesView>;
  categories: { categoryId: string; name: string }[];
  sourceStatus: HuntCategorySourceStatus;
  sorts: readonly string[];
  commissionBands: readonly string[];
  presets: { key: HuntPreset; definition: HuntProviderPresetDefinition }[];
  limits: {
    huntsMax: number; topNMax: number; topNDefault: number; repeatAfterDaysMin: number; repeatAfterDaysMax: number;
    repeatAfterDaysDefault: number; intervalMinutesMin: number; intervalMinutesMax: number; keywordMaxLength: number;
    nameMaxLength: number; endsWithinDaysMax: number;
  };
  gates: OfferHunterGates;
}

export interface GetOfferHunterOptionsDeps {
  entitlements: IEntitlementReader;
  credentials: Pick<IAffiliateCredentialGateway, 'resolveState'>;
  riskGate: IMarketplaceRiskGate;
  ai: IHuntAiAvailability;
  settings: Pick<IOfferHunterSettingsRepository, 'get'>;
  providers: Pick<IHuntProviderRegistry, 'get'>;
}

/** Portões de uma marca sem chamar a fonte (estado da credencial junto, para o status das categorias). */
async function providerGates(
  deps: GetOfferHunterOptionsDeps, tenantId: string, adapter: IHuntProviderAdapter,
  shared: { hunter: boolean; aiAvailable: boolean; destination: boolean },
): Promise<{ gates: OfferHunterGates; state: AffiliateCredentialState }> {
  const provider = adapter.provider;
  const planKey = HUNT_PROVIDER_PLAN_KEY[provider];
  const [plan, state, riskAccepted] = await Promise.all([
    planKey ? deps.entitlements.getBoolean(tenantId, planKey) : Promise.resolve(true),
    deps.credentials.resolveState(tenantId, provider),
    deps.riskGate.isAccepted(tenantId, provider, 'OFFER_HUNTER'),
  ]);
  return {
    state,
    gates: {
      plan: plan === true,
      hunterEntitlement: shared.hunter,
      credential: state.state === 'ok' && adapter.sessionFrom(state.cred) !== null,
      riskAccepted,
      aiAvailable: shared.aiAvailable,
      destination: shared.destination,
    },
  };
}

async function sharedGates(deps: GetOfferHunterOptionsDeps, tenantId: string) {
  const [hunter, aiAvailable, settings] = await Promise.all([
    deps.entitlements.getBoolean(tenantId, ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED),
    deps.ai.isAvailable(tenantId).catch(() => false),
    deps.settings.get(tenantId),
  ]);
  return { hunter: hunter === true, aiAvailable, destination: !!(settings?.sessionId && settings.conversationId) };
}

/**
 * Tudo que o assistente precisa numa chamada, para a marca pedida (padrão SHEIN). Categorias vêm da fonte da
 * marca com a sessão do tenant, só com plano, caçador e aceite em dia (a mesma ordem da execução); falha da
 * fonte vira `sourceStatus`, nunca erro. A sessão só vai à fonte; a saída não carrega token, cookie, `memberId` nem `did`.
 */
export class GetOfferHunterOptionsUseCase {
  constructor(private readonly deps: GetOfferHunterOptionsDeps) {}

  async execute(tenantId: string, provider: HuntProvider = 'SHEIN'): Promise<OfferHunterOptions> {
    const adapter = this.deps.providers.get(provider);
    const caps = adapter.capabilities;
    const { gates, state } = await providerGates(this.deps, tenantId, adapter, await sharedGates(this.deps, tenantId));

    let categories: OfferHunterOptions['categories'] = [];
    let sourceStatus: HuntCategorySourceStatus;
    const session = state.state === 'ok' ? adapter.sessionFrom(state.cred) : null;
    if (!gates.plan || !gates.hunterEntitlement || !gates.riskAccepted) sourceStatus = 'LOCKED';
    else if (state.state === 'rejected') sourceStatus = 'CREDENTIAL_REJECTED';
    else if (!session) sourceStatus = 'NO_CREDENTIAL';
    else {
      try {
        const list = await adapter.catalog.listCategories(session);
        categories = list.flatMap((c) => (c.categoryId ? [{ categoryId: c.categoryId, name: c.name }] : []));
        sourceStatus = 'OK';
      } catch (err) {
        sourceStatus = err instanceof AffiliateCredentialRejectedError ? 'CREDENTIAL_REJECTED' : 'UNAVAILABLE';
        logger.warn({ tenantId, provider, code: (err as { code?: string }).code ?? 'UNEXPECTED' }, 'offer hunter categories unavailable');
      }
    }

    return {
      provider,
      capabilities: huntCapabilitiesView(caps),
      categories,
      sourceStatus,
      sorts: caps.sorts,
      // Faixa da fonte agora é derivada do filtro de comissão: campo mantido vazio por compatibilidade
      commissionBands: [],
      presets: huntPresetsFor(caps),
      limits: {
        huntsMax: HUNTER_LIMITS.huntsPerTenantMax,
        topNMax: HUNTER_LIMITS.topNMax,
        topNDefault: HUNTER_LIMITS.topNDefault,
        repeatAfterDaysMin: HUNTER_LIMITS.repeatAfterDaysMin,
        repeatAfterDaysMax: HUNTER_LIMITS.repeatAfterDaysMax,
        repeatAfterDaysDefault: HUNTER_LIMITS.repeatAfterDaysDefault,
        intervalMinutesMin: HUNTER_LIMITS.intervalMinutesMin,
        intervalMinutesMax: HUNTER_LIMITS.intervalMinutesMax,
        keywordMaxLength: HUNTER_LIMITS.keywordMaxLength,
        nameMaxLength: HUNTER_LIMITS.nameMaxLength,
        endsWithinDaysMax: HUNTER_LIMITS.endsWithinDaysMax,
      },
      gates,
    };
  }
}

export interface OfferHunterProviderState {
  provider: HuntProvider;
  /** Estado da credencial da marca (o passo 0 mostra "sem conta"/"recusada"). */
  credentialState: 'OK' | 'MISSING' | 'REJECTED';
  gates: OfferHunterGates;
}

/** Passo 0 do assistente: portões de todas as marcas numa chamada leve, **sem** chamar nenhuma fonte. */
export class GetOfferHunterProvidersUseCase {
  constructor(private readonly deps: GetOfferHunterOptionsDeps) {}

  async execute(tenantId: string): Promise<{ items: OfferHunterProviderState[] }> {
    const shared = await sharedGates(this.deps, tenantId);
    const items = await Promise.all(HUNT_PROVIDERS.map(async (provider) => {
      const adapter = this.deps.providers.get(provider);
      const { gates, state } = await providerGates(this.deps, tenantId, adapter, shared);
      const credentialState: OfferHunterProviderState['credentialState'] =
        state.state === 'rejected' ? 'REJECTED' : gates.credential ? 'OK' : 'MISSING';
      return { provider, credentialState, gates };
    }));
    return { items };
  }
}

// ── Destino ──────────────────────────────────────────────────────────────────

export interface OfferHunterDestination {
  sessionId: string | null;
  conversationId: string | null;
  /** Sessão ainda do tenant e grupo ainda da sessão (falso também quando não escolhido). */
  valid: boolean;
  /** Nome do grupo conhecido pelo chat (confirmação do reenvio); null = sem nome ou inválido. */
  groupName: string | null;
}

export class GetOfferHunterDestinationUseCase {
  constructor(private readonly deps: {
    settings: Pick<IOfferHunterSettingsRepository, 'get'>;
    configs: Pick<IOfferGeneratorConfigRepository, 'findSession' | 'filterSessionGroups' | 'listSessionGroupConversations'>;
  }) {}

  async execute(tenantId: string): Promise<OfferHunterDestination> {
    const s = await this.deps.settings.get(tenantId);
    const sessionId = s?.sessionId ?? null;
    const conversationId = s?.conversationId ?? null;
    if (!sessionId || !conversationId) return { sessionId, conversationId, valid: false, groupName: null };
    const session = await this.deps.configs.findSession(tenantId, sessionId);
    const groups = session ? await this.deps.configs.filterSessionGroups(tenantId, [sessionId], [conversationId]) : [];
    if (groups.length === 0) return { sessionId, conversationId, valid: false, groupName: null };
    const known = await this.deps.configs.listSessionGroupConversations(tenantId, sessionId);
    return { sessionId, conversationId, valid: true, groupName: known.find((g) => g.conversationId === conversationId)?.title ?? null };
  }
}
