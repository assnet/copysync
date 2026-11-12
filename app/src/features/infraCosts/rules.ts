/**
 * Regras puras dos custos da infraestrutura: formatação (COST-06b), margem contra a vitrine (COST-06),
 * validação/diff do rascunho de preços (COST-01/08) e payload do `PUT` só com campos conhecidos.
 */
import { PLAN_CATALOG, type PlanCatalogItem, type PlanSlug } from '@/features/plans/catalog';
import { toPanelPlanSlug } from '@/features/plans/planSlug';
import type { AiProviderKind } from '@/types/api.types';
import { infraCostsStrings as S } from './strings';
import type {
  CostFilters,
  InfraCostAllocation,
  InfraCostBilling,
  InfraCostCategory,
  InfraCostItem,
  InfraCostSettings,
  InfraCostSettingsChange,
  InfraCostSettingsDraft,
  InfraCostSettingsSource,
  InfraFxClosingMethod,
  InfraRenderKey,
  InfraRenderResourceType,
  PlanMargin,
  PlanMarginLine,
} from './types';

export const DEFAULT_COST_FILTERS: CostFilters = { month: null, basis: 'contracted', plan: 'all' };

/* ── Formatação (COST-06b) ──────────────────────────────────────────── */

/** Arredonda meio para cima (para longe do zero) sem o erro binário (1,005 → 1,01). */
function roundHalfUp(value: number, decimals: number): number {
  const f = 10 ** decimals;
  const scaled = Number((Math.abs(value) * f).toPrecision(15));
  return (Math.sign(value) * Math.round(scaled)) / f;
}

function formatMoney(value: number | null | undefined, currency: 'USD' | 'BRL'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return S.noValue;
  const decimals = value !== 0 && Math.abs(value) < 0.01 ? 4 : 2;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(roundHalfUp(value, decimals));
}

/** US$ com 2 casas; 4 casas quando |valor| < 0,01. `null` → "—". */
export const formatUsd = (value: number | null | undefined) => formatMoney(value, 'USD');
/** R$ com 2 casas; 4 casas quando |valor| < 0,01. `null` (sem cotação) → "—". */
export const formatBrl = (value: number | null | undefined) => formatMoney(value, 'BRL');

/** Percentual com 1 casa ("12,3%"). */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return S.noValue;
  return `${roundHalfUp(value, 1).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function originLabel(origin: InfraCostSettingsSource): string {
  return S.origin[origin];
}

/* ── Margem (COST-06) ───────────────────────────────────────────────── */

/** Slug do domínio (`COPYSYNC_LITE`) → item do catálogo (`lite`); sem plano/desconhecido → `null`. */
export function catalogSlugOf(planSlug: string | null | undefined): PlanSlug | null {
  return planSlug ? toPanelPlanSlug(planSlug) : null;
}

function marginLine(priceBrl: number, costBrl: number): PlanMarginLine {
  const marginBrl = priceBrl - costBrl;
  return { priceBrl, marginBrl, marginPct: priceBrl > 0 ? (marginBrl / priceBrl) * 100 : null };
}

/**
 * Margem bruta de infraestrutura = preço de vitrine (R$) − custo por tenant (R$), mensal e
 * anual-equivalente. Preço só do catálogo; sem cotação (`costBrl` nulo) ou plano fora do catálogo → `null`.
 */
export function planMargin(
  planSlug: string | null | undefined,
  costBrl: number | null | undefined,
  catalog: readonly PlanCatalogItem[] = PLAN_CATALOG,
): PlanMargin | null {
  if (costBrl === null || costBrl === undefined || !Number.isFinite(costBrl)) return null;
  const slug = catalogSlugOf(planSlug);
  const plan = slug ? catalog.find((p) => p.slug === slug) : undefined;
  if (!plan) return null;
  return {
    slug: plan.slug,
    monthly: marginLine(plan.price, costBrl),
    annual: marginLine(plan.priceAnnualMonthly, costBrl),
  };
}

/* ── Rascunho de preços (COST-01) ───────────────────────────────────── */

/** Limites iguais ao domínio da API (`INFRA_COST_LIMITS` em `metrics/domain/services/infraCostSettings.ts`). */
export const INFRA_COST_LIMITS = {
  maxItems: 40,
  maxRenderPlanPrices: 60,
  maxAiModelPrices: 60,
  maxLabelLength: 80,
  maxNoteLength: 280,
  maxPlanNameLength: 60,
  maxModelLength: 120,
} as const;
const L = INFRA_COST_LIMITS;

const CATEGORIES: readonly InfraCostCategory[] = ['compute', 'database', 'cache', 'static', 'storage', 'ai', 'email', 'platform', 'other'];
const BILLINGS: readonly InfraCostBilling[] = ['fixed', 'per_instance', 'usage'];
const RENDER_KEYS: readonly InfraRenderKey[] = ['api', 'worker', 'redis', 'postgres', 'static'];
const ALLOCATIONS: readonly InfraCostAllocation[] = ['shared', 'excluded'];
const RESOURCE_TYPES: readonly InfraRenderResourceType[] = ['service', 'postgres', 'key_value'];
const CLOSING_METHODS: readonly InfraFxClosingMethod[] = ['last_business_day', 'month_average'];
const AI_KINDS: readonly AiProviderKind[] = ['ANTHROPIC', 'OPENAI', 'GEMINI', 'XAI', 'DEEPSEEK', 'GROQ', 'MISTRAL', 'OPENROUTER', 'OPENAI_COMPATIBLE'];
const KEY_FORMAT = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const DRAFT_NUMBER = /^\d+([.,]\d+)?$/;

/** Número do rascunho: dígitos com no máximo um `.` ou `,` (sem sinal, hexa, expoente). Vazio/inválido → `null`. */
export function parseDraftNumber(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return DRAFT_NUMBER.test(text) ? Number(text.replace(',', '.')) : null;
}

interface NumRule { min: number; max: number; integer?: boolean; decimals?: number; nullable?: boolean }

const fmt = (n: number) => n.toLocaleString('pt-BR');

function isValidDate(text: string): boolean {
  if (!DATE_FORMAT.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

/** Lê o rascunho inteiro: valor convertido e erros por caminho (`items[0].monthlyUsd`). */
export function parseSettingsDraft(
  draft: InfraCostSettingsDraft,
): { settings: InfraCostSettings | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const e = S.errors;

  const num = (path: string, raw: number | string | null | undefined, rule: NumRule): number | null => {
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
      if (!rule.nullable) errors[path] = e.required;
      return null;
    }
    const n = parseDraftNumber(raw);
    if (n === null) { errors[path] = e.number; return null; }
    if (rule.integer && !Number.isInteger(n)) { errors[path] = e.integer; return null; }
    if (n < rule.min || n > rule.max) { errors[path] = e.range(fmt(rule.min), fmt(rule.max)); return null; }
    if (rule.decimals !== undefined && roundHalfUp(n, rule.decimals) !== n) { errors[path] = e.decimals(rule.decimals); return null; }
    return n;
  };
  const text = (path: string, raw: unknown, max: number): string => {
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (v.length === 0 || v.length > max) errors[path] = e.text(max);
    return v;
  };
  /** Texto opcional: vazio vira `null` (como a API). */
  const optionalText = (path: string, raw: unknown, max: number): string | null => {
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (v.length > max) errors[path] = e.textMax(max);
    return v.length === 0 ? null : v;
  };
  const option = <T extends string>(path: string, raw: unknown, allowed: readonly T[]): T => {
    if (!allowed.includes(raw as T)) errors[path] = e.option;
    return raw as T;
  };
  const list = <T>(path: string, raw: readonly T[] | undefined, max: number): readonly T[] => {
    const arr = Array.isArray(raw) ? raw : [];
    if (arr.length > max) errors[path] = e.listMax(max);
    return arr;
  };
  const unique = (path: string, seen: Set<string>, id: string) => {
    if (seen.has(id)) errors[path] = e.duplicate;
    seen.add(id);
  };

  const fxDraft = draft.fx;
  const override = fxDraft?.override
    ? {
        rate: num('fx.override.rate', fxDraft.override.rate, { min: 1, max: 20, decimals: 4 }) as number,
        date: (() => {
          const d = typeof fxDraft.override.date === 'string' ? fxDraft.override.date.trim() : '';
          if (!isValidDate(d)) errors['fx.override.date'] = e.date;
          return d;
        })(),
      }
    : null;
  const fx = {
    auto: fxDraft?.auto === true,
    override,
    closingMethod: option('fx.closingMethod', fxDraft?.closingMethod, CLOSING_METHODS),
  };

  const keys = new Set<string>();
  const renderKeys = new Set<string>();
  const items: InfraCostItem[] = list('items', draft.items, L.maxItems).map((it, i) => {
    const p = `items[${i}]`;
    const key = typeof it.key === 'string' ? it.key.trim() : '';
    if (!KEY_FORMAT.test(key)) errors[`${p}.key`] = e.keyFormat;
    else unique(`${p}.key`, keys, key);
    return {
      key,
      label: text(`${p}.label`, it.label, L.maxLabelLength),
      category: option(`${p}.category`, it.category, CATEGORIES),
      billing: option(`${p}.billing`, it.billing, BILLINGS),
      monthlyUsd: num(`${p}.monthlyUsd`, it.monthlyUsd, { min: 0, max: 100_000 }) as number,
      quantity: num(`${p}.quantity`, it.quantity, { min: 0, max: 100, integer: true }) as number,
      storage: it.storage
        ? {
            gb: num(`${p}.storage.gb`, it.storage.gb, { min: 0, max: 10_000, nullable: true }),
            usdPerGb: num(`${p}.storage.usdPerGb`, it.storage.usdPerGb, { min: 0, max: 10, nullable: true }),
          }
        : null,
      renderKey: it.renderKey === null ? null : (() => {
        const rk = option(`${p}.renderKey`, it.renderKey, RENDER_KEYS);
        if (RENDER_KEYS.includes(rk)) unique(`${p}.renderKey`, renderKeys, rk);
        return rk;
      })(),
      planLabel: optionalText(`${p}.planLabel`, it.planLabel, L.maxLabelLength),
      allocation: option(`${p}.allocation`, it.allocation, ALLOCATIONS),
      note: optionalText(`${p}.note`, it.note, L.maxNoteLength),
    };
  });

  const planIds = new Set<string>();
  const renderPlanPrices = list('renderPlanPrices', draft.renderPlanPrices, L.maxRenderPlanPrices).map((r, i) => {
    const p = `renderPlanPrices[${i}]`;
    const resourceType = option(`${p}.resourceType`, r.resourceType, RESOURCE_TYPES);
    const plan = text(`${p}.plan`, r.plan, L.maxPlanNameLength);
    if (plan) unique(`${p}.plan`, planIds, `${resourceType}:${plan}`);
    return { resourceType, plan, monthlyUsd: num(`${p}.monthlyUsd`, r.monthlyUsd, { min: 0, max: 100_000 }) as number };
  });

  const modelIds = new Set<string>();
  const aiModelPrices = list('aiModelPrices', draft.aiModelPrices, L.maxAiModelPrices).map((m, i) => {
    const p = `aiModelPrices[${i}]`;
    const kind = option(`${p}.kind`, m.kind, AI_KINDS);
    const model = text(`${p}.model`, m.model, L.maxModelLength);
    if (model) unique(`${p}.model`, modelIds, `${kind}:${model}`);
    return {
      kind,
      model,
      inputPerMTokUsd: num(`${p}.inputPerMTokUsd`, m.inputPerMTokUsd, { min: 0, max: 1_000 }) as number,
      outputPerMTokUsd: num(`${p}.outputPerMTokUsd`, m.outputPerMTokUsd, { min: 0, max: 1_000 }) as number,
    };
  });

  const w = draft.workspace;
  const workspace = {
    planLabel: text('workspace.planLabel', w?.planLabel, L.maxLabelLength),
    cycleStartDay: num('workspace.cycleStartDay', w?.cycleStartDay, { min: 1, max: 28, integer: true }) as number,
    includedBandwidthGb: num('workspace.includedBandwidthGb', w?.includedBandwidthGb, { min: 0, max: 100_000 }) as number,
    includedBuildMinutes: num('workspace.includedBuildMinutes', w?.includedBuildMinutes, { min: 0, max: 1_000_000, integer: true }) as number,
    bandwidthUsdPerGb: num('workspace.bandwidthUsdPerGb', w?.bandwidthUsdPerGb, { min: 0, max: 10 }) as number,
    buildUsdPer1000Min: num('workspace.buildUsdPer1000Min', w?.buildUsdPer1000Min, { min: 0, max: 1_000 }) as number,
    manualBandwidthGb: num('workspace.manualBandwidthGb', w?.manualBandwidthGb, { min: 0, max: 1_000_000, nullable: true }),
    manualBuildMinutes: num('workspace.manualBuildMinutes', w?.manualBuildMinutes, { min: 0, max: 10_000_000, integer: true, nullable: true }),
  };

  const ok = Object.keys(errors).length === 0;
  return {
    settings: ok ? { fx, items, renderPlanPrices: [...renderPlanPrices], aiModelPrices: [...aiModelPrices], workspace } : null,
    errors,
  };
}

/** Erro por caminho do rascunho; objeto vazio = válido. */
export function validateSettingsDraft(draft: InfraCostSettingsDraft): Record<string, string> {
  return parseSettingsDraft(draft).errors;
}

/** Rascunho válido → configuração; `null` com erro. */
export function draftToSettings(draft: InfraCostSettingsDraft): InfraCostSettings | null {
  return parseSettingsDraft(draft).settings;
}

/**
 * Corpo do `PUT` reconstruído só com os campos do contrato: nada além da configuração sai do painel
 * (preço de plano nunca vai para a API).
 */
export function toSettingsPayload(s: InfraCostSettings): InfraCostSettings {
  return {
    fx: {
      auto: s.fx.auto,
      override: s.fx.override ? { rate: s.fx.override.rate, date: s.fx.override.date } : null,
      closingMethod: s.fx.closingMethod,
    },
    items: s.items.map((i) => ({
      key: i.key,
      label: i.label,
      category: i.category,
      billing: i.billing,
      monthlyUsd: i.monthlyUsd,
      quantity: i.quantity,
      storage: i.storage ? { gb: i.storage.gb, usdPerGb: i.storage.usdPerGb } : null,
      renderKey: i.renderKey,
      planLabel: i.planLabel,
      allocation: i.allocation,
      note: i.note,
    })),
    renderPlanPrices: s.renderPlanPrices.map((r) => ({ resourceType: r.resourceType, plan: r.plan, monthlyUsd: r.monthlyUsd })),
    aiModelPrices: s.aiModelPrices.map((m) => ({
      kind: m.kind,
      model: m.model,
      inputPerMTokUsd: m.inputPerMTokUsd,
      outputPerMTokUsd: m.outputPerMTokUsd,
    })),
    workspace: {
      planLabel: s.workspace.planLabel,
      cycleStartDay: s.workspace.cycleStartDay,
      includedBandwidthGb: s.workspace.includedBandwidthGb,
      includedBuildMinutes: s.workspace.includedBuildMinutes,
      bandwidthUsdPerGb: s.workspace.bandwidthUsdPerGb,
      buildUsdPer1000Min: s.workspace.buildUsdPer1000Min,
      manualBandwidthGb: s.workspace.manualBandwidthGb,
      manualBuildMinutes: s.workspace.manualBuildMinutes,
    },
  };
}

/* ── Diff da confirmação (COST-08) ──────────────────────────────────── */

type Leaf = string | number | boolean | null;

function flatten(value: unknown, prefix: string, out: Map<string, Leaf>): void {
  if (value === null || typeof value !== 'object') {
    out.set(prefix, (value ?? null) as Leaf);
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
}

interface Keyed { id: string; name: string; value: object }

function listEntries(s: InfraCostSettings): Map<string, Keyed> {
  const out = new Map<string, Keyed>();
  for (const i of s.items) out.set(`items[${i.key}]`, { id: i.key, name: i.label, value: i });
  for (const r of s.renderPlanPrices) out.set(`renderPlanPrices[${r.resourceType}:${r.plan}]`, { id: r.plan, name: r.plan, value: r });
  for (const m of s.aiModelPrices) out.set(`aiModelPrices[${m.kind}:${m.model}]`, { id: m.model, name: m.model, value: m });
  return out;
}

function leaves(s: InfraCostSettings): Map<string, Leaf> {
  const out = new Map<string, Leaf>();
  flatten(s.fx, 'fx', out);
  flatten(s.workspace, 'workspace', out);
  for (const [path, entry] of listEntries(s)) flatten(entry.value, path, out);
  return out;
}

/**
 * O que muda entre o salvo e o rascunho. Linhas das listas casam pela identidade (`key`; tipo+plano;
 * provedor+modelo), não pela posição: reordenar não gera diff. Linha nova/removida sai uma vez só.
 */
export function diffSettings(before: InfraCostSettings, after: InfraCostSettings): InfraCostSettingsChange[] {
  const changes: InfraCostSettingsChange[] = [];
  const bEntries = listEntries(before);
  const aEntries = listEntries(after);
  const bLeaves = leaves(before);
  const aLeaves = leaves(after);
  const entryOf = (path: string) => path.match(/^[a-zA-Z]+\[[^\]]+\]/)?.[0] ?? null;

  for (const [path, to] of aLeaves) {
    const entry = entryOf(path);
    if (entry && !bEntries.has(entry)) continue;
    const from = bLeaves.has(path) ? (bLeaves.get(path) as Leaf) : null;
    if (from !== to) changes.push({ kind: 'changed', path, from, to });
  }
  for (const [path, from] of bLeaves) {
    if (aLeaves.has(path)) continue;
    const entry = entryOf(path);
    if (entry && !aEntries.has(entry)) continue;
    if (from !== null) changes.push({ kind: 'changed', path, from, to: null });
  }
  for (const [path, entry] of aEntries) {
    if (!bEntries.has(path)) changes.push({ kind: 'added', path, from: null, to: entry.name });
  }
  for (const [path, entry] of bEntries) {
    if (!aEntries.has(path)) changes.push({ kind: 'removed', path, from: entry.name, to: null });
  }
  return changes;
}

/** Configuração → rascunho (números continuam números; o input converte ao editar). */
export function settingsToDraft(s: InfraCostSettings): InfraCostSettingsDraft {
  return toSettingsPayload(s);
}
