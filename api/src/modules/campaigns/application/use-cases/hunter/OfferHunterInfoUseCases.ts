import type { IOfferHuntRunRepository } from '../../../domain/contracts/hunter/IOfferHuntRunRepository';
import type { IOfferHuntFindRepository } from '../../../domain/contracts/hunter/IOfferHuntFindRepository';
import type { IOfferHunterSettingsRepository } from '../../../domain/contracts/hunter/IOfferHunterSettingsRepository';
import type { IOfferGeneratorConfigRepository } from '../../../domain/contracts/IOfferGeneratorConfigRepository';
import type { ISheinCatalogClient } from '../../../domain/contracts/ISheinCatalogClient';
import type { IAffiliateCredentialGateway } from '../../../domain/contracts/IAffiliateCredentialGateway';
import type { IEntitlementReader } from '../../../domain/contracts/IEntitlementReader';
import type { IMarketplaceRiskGate } from '../../../domain/contracts/IMarketplaceRiskGate';
import type { IHuntAiAvailability } from '../../hunter/contracts/IHuntAiAvailability';
import { HUNT_COMMISSION_BANDS, HUNT_SORTS, type HuntCommissionBand, type HuntSort } from '../../../domain/hunter/HuntCandidate';
import { HUNT_PRESETS, huntPreset, type HuntPreset, type HuntPresetDefinition } from '../../../domain/services/hunter/huntPresets';
import { HUNTER_LIMITS } from '../../../domain/services/hunter/hunterLimits';
import { startOfDayInZone } from '../../../domain/services/startOfDayInZone';
import { ENTITLEMENT_KEYS } from '../../../../tenants/domain/entitlementKeys';
import { AffiliateCredentialRejectedError } from '../../../../../shared/errors/internal/OfferErrors';
import { logger } from '../../../../../shared/logger/logger';

const PROVIDER = 'SHEIN' as const;

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
}

export class GetOfferHunterUsageUseCase {
  constructor(private readonly deps: {
    finds: Pick<IOfferHuntFindRepository, 'countCreatedSince'>;
    runs: Pick<IOfferHuntRunRepository, 'countStartedSince'>;
    entitlements: IEntitlementReader;
    now?: () => Date;
  }) {}

  async execute(tenantId: string): Promise<OfferHunterUsage> {
    const since = startOfDayInZone((this.deps.now ?? (() => new Date()))());
    const [limitRaw, used, runsToday] = await Promise.all([
      this.deps.entitlements.getNumber(tenantId, ENTITLEMENT_KEYS.OFFER_HUNTER_FINDS_PER_DAY),
      this.deps.finds.countCreatedSince(tenantId, since),
      this.deps.runs.countStartedSince(tenantId, since),
    ]);
    const limit = limitRaw ?? 0;
    return { used, limit, remaining: Math.max(0, limit - used), runsToday, runsMax: HUNTER_LIMITS.runsPerDayMax };
  }
}

// ── Opções do assistente ─────────────────────────────────────────────────────

/**
 * Estado da lista de categorias. `LOCKED` = portão anterior fechado (plano, caçador ou aceite): a fonte
 * nem é chamada. Qualquer estado ≠ `OK` devolve lista vazia; a tela não falha.
 */
export type HuntCategorySourceStatus = 'OK' | 'LOCKED' | 'NO_CREDENTIAL' | 'CREDENTIAL_REJECTED' | 'UNAVAILABLE';

export interface OfferHunterGates {
  /** `marketplace_shein_enabled`. */
  plan: boolean;
  /** `offer_hunter_enabled`. */
  hunterEntitlement: boolean;
  /** Conta Shein conectada, não recusada, com sessão. */
  credential: boolean;
  /** Aviso de risco do caçador (`OFFER_HUNTER`) na versão vigente. */
  riskAccepted: boolean;
  aiAvailable: boolean;
  destination: boolean;
}

export interface OfferHunterOptions {
  categories: { categoryId: string; name: string }[];
  sourceStatus: HuntCategorySourceStatus;
  sorts: readonly HuntSort[];
  commissionBands: readonly HuntCommissionBand[];
  presets: { key: HuntPreset; definition: HuntPresetDefinition }[];
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
  catalog: Pick<ISheinCatalogClient, 'listCategories'>;
}

/**
 * Tudo que o assistente precisa numa chamada. Categorias vêm da fonte com a sessão do tenant, só com
 * plano, caçador e aceite em dia (a mesma ordem da execução); falha da fonte vira `sourceStatus`, nunca erro.
 * O `AT` só vai ao cliente do catálogo; a saída não carrega token, `memberId` nem `did`.
 */
export class GetOfferHunterOptionsUseCase {
  constructor(private readonly deps: GetOfferHunterOptionsDeps) {}

  async execute(tenantId: string): Promise<OfferHunterOptions> {
    const { entitlements } = this.deps;
    const [plan, hunter, state, riskAccepted, aiAvailable, settings] = await Promise.all([
      entitlements.getBoolean(tenantId, ENTITLEMENT_KEYS.MARKETPLACE_SHEIN_ENABLED),
      entitlements.getBoolean(tenantId, ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED),
      this.deps.credentials.resolveState(tenantId, PROVIDER),
      this.deps.riskGate.isAccepted(tenantId, PROVIDER, 'OFFER_HUNTER'),
      this.deps.ai.isAvailable(tenantId).catch(() => false),
      this.deps.settings.get(tenantId),
    ]);
    const token = state.state === 'ok' ? state.cred.session?.cookies?.AT : undefined;
    const gates: OfferHunterGates = {
      plan: plan === true,
      hunterEntitlement: hunter === true,
      credential: state.state === 'ok' && !!token,
      riskAccepted,
      aiAvailable,
      destination: !!(settings?.sessionId && settings.conversationId),
    };

    let categories: OfferHunterOptions['categories'] = [];
    let sourceStatus: HuntCategorySourceStatus;
    if (!gates.plan || !gates.hunterEntitlement || !gates.riskAccepted) sourceStatus = 'LOCKED';
    else if (state.state === 'rejected') sourceStatus = 'CREDENTIAL_REJECTED';
    else if (state.state !== 'ok' || !token) sourceStatus = 'NO_CREDENTIAL';
    else {
      try {
        const list = await this.deps.catalog.listCategories({ token, memberId: state.cred.publicIdentifier });
        categories = list.flatMap((c) => (c.categoryId ? [{ categoryId: c.categoryId, name: c.name }] : []));
        sourceStatus = 'OK';
      } catch (err) {
        sourceStatus = err instanceof AffiliateCredentialRejectedError ? 'CREDENTIAL_REJECTED' : 'UNAVAILABLE';
        logger.warn({ tenantId, code: (err as { code?: string }).code ?? 'UNEXPECTED' }, 'offer hunter categories unavailable');
      }
    }

    return {
      categories,
      sourceStatus,
      sorts: HUNT_SORTS,
      commissionBands: HUNT_COMMISSION_BANDS,
      presets: HUNT_PRESETS.map((key) => ({ key, definition: huntPreset(key) })),
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

// ── Destino ──────────────────────────────────────────────────────────────────

export interface OfferHunterDestination {
  sessionId: string | null;
  conversationId: string | null;
  /** Sessão ainda do tenant e grupo ainda da sessão (falso também quando não escolhido). */
  valid: boolean;
}

export class GetOfferHunterDestinationUseCase {
  constructor(private readonly deps: {
    settings: Pick<IOfferHunterSettingsRepository, 'get'>;
    configs: Pick<IOfferGeneratorConfigRepository, 'findSession' | 'filterSessionGroups'>;
  }) {}

  async execute(tenantId: string): Promise<OfferHunterDestination> {
    const s = await this.deps.settings.get(tenantId);
    const sessionId = s?.sessionId ?? null;
    const conversationId = s?.conversationId ?? null;
    if (!sessionId || !conversationId) return { sessionId, conversationId, valid: false };
    const session = await this.deps.configs.findSession(tenantId, sessionId);
    const groups = session ? await this.deps.configs.filterSessionGroups(tenantId, [sessionId], [conversationId]) : [];
    return { sessionId, conversationId, valid: groups.length > 0 };
  }
}
