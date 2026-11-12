/**
 * Regras puras dos custos da infraestrutura: formatação (COST-06b), margem contra a vitrine (COST-06),
 * validação/diff do rascunho de preços (COST-01/08) e payload do `PUT` só com campos conhecidos.
 */
import { PLAN_CATALOG, type PlanCatalogItem, type PlanSlug } from '@/features/plans/catalog';
import { toPanelPlanSlug } from '@/features/plans/planSlug';
import type { AiProviderKind } from '@/types/api.types';
import { aiProviderName } from '@/features/ai/aiProviders';
import { planEntitlementsAdminStrings, planName } from '@/features/planEntitlementsAdmin/strings';
import { sortPlansByCatalog } from '@/features/workersAdmin/rules';
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
  InfraCostPlanView,
  InfraCostSplitBasis,
  InfraCostSummary,
  InfraCostWarning,
  InfraCostWarningCode,
  InfraMoney,
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
/** "1.000", "12.500.000": ponto de milhar, ambíguo com decimal — recusado (decimal é vírgula). */
const THOUSANDS_DOT = /^\d{1,3}(\.\d{3})+$/;

/** Texto com ponto de milhar (`1.000`): o rascunho recusa em vez de adivinhar. */
export function hasThousandsDot(value: number | string | null | undefined): boolean {
  return typeof value === 'string' && THOUSANDS_DOT.test(value.trim());
}

/**
 * Número do rascunho: dígitos com no máximo um `,` decimal (ou `.` que não seja milhar); sem sinal,
 * hexa, expoente. Ponto de milhar (`1.000`), vazio ou inválido → `null`.
 */
export function parseDraftNumber(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (THOUSANDS_DOT.test(text)) return null;
  return DRAFT_NUMBER.test(text) ? Number(text.replace(',', '.')) : null;
}

/** Número do rascunho como o input mostra: vírgula decimal, sem milhar (`0.25` → `0,25`). */
export function draftNumberText(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'number' ? String(value).replace('.', ',') : value;
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
    if (hasThousandsDot(raw)) { errors[path] = S.pricesReview.thousandsDot; return null; }
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
    // Só dígitos colide com o índice da linha (`items[2]`) nos caminhos de erro e do diff.
    else if (/^\d+$/.test(key)) errors[`${p}.key`] = e.keyNumeric;
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

/* ── Valores legíveis do diff e índices do formulário (aba Preços) ──── */

const PR = S.prices;
type CostList = 'items' | 'renderPlanPrices' | 'aiModelPrices';

/** Rótulo de uma linha do diff: linha removida só existe no salvo, então o nome sai de `before`. */
export function changeLabel(path: string, before: InfraCostSettings, after: InfraCostSettings): string {
  const key = path.match(/^items\[([^\]]+)\]/)?.[1];
  const removed = key !== undefined && !after.items.some((i) => i.key === key);
  return fieldLabel(path, removed ? before : after);
}

/** Campos em US$: o diff mostra com moeda ("US$ 25,00 → US$ 30,50"). */
const USD_FIELDS = new Set(['monthlyUsd', 'usdPerGb', 'inputPerMTokUsd', 'outputPerMTokUsd', 'bandwidthUsdPerGb', 'buildUsdPer1000Min']);

/** US$ com 2 a 4 casas: o diff não pode esconder a diferença por arredondamento (0,155 × 0,16). */
function formatUsdExact(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
}

/** Valor exibido no diff: opções pelo rótulo, preço com US$, número em pt-BR, vazio = "—". */
export function changeValue(path: string, value: InfraCostSettingsChange['from']): string {
  if (value === null || value === '') return S.noValue;
  if (typeof value === 'boolean') return value ? PR.yes : PR.no;
  const field = path.split('.').pop() ?? '';
  if (typeof value === 'number') {
    return USD_FIELDS.has(field) ? formatUsdExact(value) : value.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
  }
  if (field === 'kind') return aiProviderName(value as AiProviderKind);
  const maps: Record<string, Record<string, string>> = {
    category: S.category, billing: S.billing, renderKey: S.renderKey, allocation: S.allocation,
    closingMethod: S.closingMethod, resourceType: S.resourceType,
  };
  return maps[field]?.[value] ?? value;
}

/* ── Erros e índices do formulário ──────────────────────────────────── */

/** Erros sob um prefixo (`items[0]` conta `items[0].label`; `items` conta todas as linhas). */
export function countErrors(errors: Record<string, string>, prefix: string): number {
  return Object.keys(errors).filter((k) => k === prefix || k.startsWith(`${prefix}.`) || k.startsWith(`${prefix}[`)).length;
}

/** `items[3].storage.gb` → `{ list: 'items', index: 3 }`; fora de lista ou sem índice → `null`. */
export function listEntryOfPath(path: string): { list: CostList; index: number } | null {
  const m = path.match(/^(items|renderPlanPrices|aiModelPrices)\[(\d+)\]/);
  return m ? { list: m[1] as CostList, index: Number(m[2]) } : null;
}

/** Depois de remover a linha `index`, o índice que recebe o foco: a seguinte (que herda o índice); última linha → `null`. */
export function nextIndexAfterRemoval(lengthBefore: number, index: number): number | null {
  return index < lengthBefore - 1 ? index : null;
}

/**
 * Itens abertos guardam a `key` (o índice muda ao remover). Trocar a `key` no formulário leva o
 * estado de aberto junto; a antiga só fica se outra linha ainda a usa (duas linhas novas sem `key`).
 */
export function renameOpenKey(open: readonly string[], from: string, to: string, keysAfter: readonly string[]): string[] {
  if (!open.includes(from) || from === to) return [...open];
  const keepOld = keysAfter.includes(from);
  const next = keepOld ? [...open] : open.filter((k) => k !== from);
  return next.includes(to) ? next : [...next, to];
}

/* ── Conflito de edição (409): merge de 3 vias ──────────────────────── */

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function mergeValue(path: string, base: unknown, mine: unknown, theirs: unknown, conflicts: string[]): unknown {
  if (same(mine, theirs)) return mine;
  if (base !== undefined && same(base, mine)) return theirs;
  if (base !== undefined && same(base, theirs)) return mine;
  if (isPlain(mine) && isPlain(theirs) && (base === undefined || isPlain(base))) {
    const out: Plain = {};
    for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
      out[k] = mergeValue(`${path}.${k}`, (base as Plain | undefined)?.[k], mine[k], theirs[k], conflicts);
    }
    return out;
  }
  conflicts.push(path);
  return mine;
}

function mergeList<T>(name: CostList, idOf: (row: T) => string, base: T[], mine: T[], theirs: T[], conflicts: string[]): T[] {
  const b = new Map(base.map((r) => [idOf(r), r]));
  const m = new Map(mine.map((r) => [idOf(r), r]));
  const t = new Map(theirs.map((r) => [idOf(r), r]));
  const out: T[] = [];
  for (const row of mine) {
    const id = idOf(row);
    const path = `${name}[${id}]`;
    if (t.has(id)) out.push(mergeValue(path, b.get(id), row, t.get(id), conflicts) as T);
    else if (!b.has(id)) out.push(row); // incluída por mim
    else if (!same(b.get(id), row)) { conflicts.push(path); out.push(row); } // removida por ele, alterada por mim
    // removida por ele e intocada por mim: sai
  }
  for (const row of theirs) {
    const id = idOf(row);
    if (m.has(id)) continue;
    if (!b.has(id)) out.push(row); // incluída por ele
    else if (!same(b.get(id), row)) conflicts.push(`${name}[${id}]`); // removida por mim, alterada por ele: fica removida
  }
  return out;
}

export interface InfraCostSettingsMerge {
  settings: InfraCostSettings;
  /** Caminhos no formato do diff (`items[email].monthlyUsd`) mudados dos dois lados; fica o valor de `mine`. */
  conflicts: string[];
}

/**
 * Merge de 3 vias no 409: sobre o salvo novo (`theirs`) entram só os caminhos que mudaram entre a base
 * do rascunho e o rascunho (`mine`). Linhas casam pela identidade (`key`; tipo+plano; provedor+modelo),
 * nunca pelo índice. Caminho mudado dos dois lados com valores diferentes = conflito.
 */
export function mergeSettings(base: InfraCostSettings, mine: InfraCostSettings, theirs: InfraCostSettings): InfraCostSettingsMerge {
  const [b, m, t] = [base, mine, theirs].map(toSettingsPayload);
  const conflicts: string[] = [];
  const settings: InfraCostSettings = {
    fx: mergeValue('fx', b.fx, m.fx, t.fx, conflicts) as InfraCostSettings['fx'],
    items: mergeList('items', (i) => i.key, b.items, m.items, t.items, conflicts),
    renderPlanPrices: mergeList('renderPlanPrices', (r) => `${r.resourceType}:${r.plan}`, b.renderPlanPrices, m.renderPlanPrices, t.renderPlanPrices, conflicts),
    aiModelPrices: mergeList('aiModelPrices', (x) => `${x.kind}:${x.model}`, b.aiModelPrices, m.aiModelPrices, t.aiModelPrices, conflicts),
    workspace: mergeValue('workspace', b.workspace, m.workspace, t.workspace, conflicts) as InfraCostSettings['workspace'],
  };
  return { settings, conflicts };
}

/** A linha do diff toca um caminho em conflito (o próprio, um campo dentro dele ou a linha que o contém). */
export function isConflictPath(path: string, conflicts: readonly string[]): boolean {
  return conflicts.some((c) => path === c || path.startsWith(`${c}.`) || c.startsWith(`${path}.`));
}

/** Configuração → rascunho (números continuam números; o input converte ao editar). */
export function settingsToDraft(s: InfraCostSettings): InfraCostSettingsDraft {
  return toSettingsPayload(s);
}

/* ── Rótulo legível de campo (avisos do resumo, diff e erro 400) ────── */

const pf = S.prices;

/** Nome do campo dentro de uma linha das listas (`items[…].<campo>`). */
const ROW_FIELD_NAMES: Record<string, string> = {
  label: pf.items.fields.label,
  key: pf.items.fields.key,
  category: pf.items.fields.category,
  billing: pf.items.fields.billing,
  monthlyUsd: pf.items.fields.monthlyUsd,
  quantity: pf.items.fields.quantity,
  renderKey: pf.items.fields.renderKey,
  planLabel: pf.items.fields.planLabel,
  note: pf.items.fields.note,
  allocation: pf.items.fields.allocationShort,
  storage: pf.items.fields.storageShort,
  'storage.gb': pf.items.fields.storageGb,
  'storage.usdPerGb': pf.items.fields.storageUsdPerGb,
  resourceType: pf.renderPlans.resourceType,
  plan: pf.renderPlans.plan,
  kind: pf.aiModels.kind,
  model: pf.aiModels.model,
  inputPerMTokUsd: pf.aiModels.input,
  outputPerMTokUsd: pf.aiModels.output,
};

const FX_FIELD_NAMES: Record<string, string> = {
  auto: S.pricesReview.autoField,
  closingMethod: pf.fx.closingMethod,
  override: pf.fx.override,
  'override.rate': `${pf.fx.override} · ${pf.fx.rate}`,
  'override.date': `${pf.fx.override} · ${pf.fx.date}`,
};

const LIST_TITLES: Record<string, string> = {
  items: pf.items.title,
  renderPlanPrices: pf.renderPlans.title,
  aiModelPrices: pf.aiModels.title,
};

type LabeledItem = Pick<InfraCostItem, 'key' | 'label'> & { renderKey?: InfraRenderKey | null };

/** Nome da linha da lista: aceita o índice (`items[0]`, como o 400) ou a identidade (`items[api]`, como o diff). */
function rowName(list: string, id: string, settings: InfraCostSettings | null, items: readonly LabeledItem[]): string {
  const index = /^\d+$/.test(id) ? Number(id) : null;
  if (list === 'items') {
    const it = (index !== null ? items[index] : undefined) ?? items.find((i) => i.key === id);
    return it?.label || id;
  }
  if (list === 'renderPlanPrices') {
    const row = index !== null ? settings?.renderPlanPrices[index] : undefined;
    const [type, ...plan] = row ? [row.resourceType, row.plan] : id.split(':');
    return [S.resourceType[type as InfraRenderResourceType] ?? type, plan.join(':')].filter(Boolean).join(' ');
  }
  const row = index !== null ? settings?.aiModelPrices[index] : undefined;
  const [kind, ...model] = row ? [row.kind, row.model] : id.split(':');
  return [aiProviderName(kind as AiProviderKind), model.join(':')].filter(Boolean).join(' ');
}

function labelOf(path: string, settings: InfraCostSettings | null, items: readonly LabeledItem[]): string {
  if (path.startsWith('fx.')) {
    const f = path.slice(3);
    return `${pf.fx.title} · ${FX_FIELD_NAMES[f] ?? f}`;
  }
  if (path.startsWith('workspace.')) {
    const f = path.slice('workspace.'.length);
    const name = (pf.workspace as Record<string, unknown>)[f];
    return `${pf.workspace.title} · ${typeof name === 'string' ? name : f}`;
  }
  const m = path.match(/^(items|renderPlanPrices|aiModelPrices)(?:\[([^\]]+)\])?(?:\.(.+))?$/);
  if (!m) return path;
  const [, list, id, field] = m;
  if (id === undefined) return LIST_TITLES[list];
  const name = rowName(list, id, settings, items);
  return field ? `${name} · ${ROW_FIELD_NAMES[field] ?? field}` : `${LIST_TITLES[list]} · ${name}`;
}

/**
 * Rótulo legível de um caminho de campo: "Rótulo do item · Nome do campo" (`items[0].monthlyUsd` ou
 * `items[api].monthlyUsd` → "API · Preço (US$/mês)"); fora das listas, nome da seção e do campo
 * (`workspace.planLabel` → "Workspace · Plano do workspace"). Sem configuração, usa o identificador.
 */
export function fieldLabel(path: string, settings: InfraCostSettings | null): string {
  return labelOf(path, settings, settings?.items ?? []);
}

/* ── Resumo: datas, base do rateio e avisos (COST-07) ───────────────── */

/** `YYYY-MM` → "novembro de 2026". */
export function monthLabel(month: string): string {
  const d = new Date(`${month}-01T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? month : d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** `YYYY-MM-DD` → `DD/MM/YYYY`. */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-');
  return y && m && d ? `${d}/${m}/${y}` : date;
}

/**
 * Linha do plano na base escolhida. A margem usa sempre a base contratadas: no mês corrente por horas, o tenant
 * médio **projetado** para o mês cheio (`projectedCostPerTenant`); senão o realizado (`costPerTenant`).
 */
export interface PlanBasisRow {
  plan: InfraCostPlanView;
  sessions: number;
  share: InfraMoney | null;
  perTenant: InfraMoney | null;
  /** Custo do tenant médio na base contratadas: base da margem, qualquer que seja o filtro. */
  marginCost: InfraMoney | null;
}

/** Planos na ordem do catálogo, filtrados pelo plano escolhido, com sessões e custo da base do filtro. */
export function planRowsByBasis(
  plans: readonly InfraCostPlanView[],
  filters: Pick<CostFilters, 'basis' | 'plan'>,
  projectedMargin = false,
): PlanBasisRow[] {
  const connected = filters.basis === 'connected';
  return sortPlansByCatalog(plans)
    .filter((row) => filters.plan === 'all' || catalogSlugOf(row.planSlug) === filters.plan)
    .map((row) => ({
      plan: row,
      sessions: connected ? row.connectedSessions : row.contractedSessions,
      share: connected ? row.connectedShare : row.share,
      perTenant: connected ? row.connectedCostPerTenant : row.costPerTenant,
      marginCost: projectedMargin ? row.projectedCostPerTenant ?? null : row.costPerTenant,
    }));
}

/** `YYYY-MM` (UTC) de um instante em ms. */
export function utcMonthOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

/** Meses que o seletor oferece: o corrente e os 11 anteriores (UTC, do mais novo ao mais velho). */
export const COST_MONTHS_BACK = 11;
export function costMonthOptions(nowMs: number): string[] {
  const d = new Date(nowMs);
  return Array.from({ length: COST_MONTHS_BACK + 1 }, (_, i) =>
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
}

/**
 * Mês corrente somado por horas: a margem e a projeção usam o mês cheio projetado (marcado "projetada").
 * Mês passado usa o realizado; foto (sem snapshot) já é o mês cheio.
 */
export function isProjectedMonth(summary: Pick<InfraCostSummary, 'basis' | 'month' | 'generatedAt' | 'totals'>): boolean {
  return summary.basis === 'hours' && summary.totals.projected !== null && summary.month === summary.generatedAt.slice(0, 7);
}

/** Sessões e custo por sessão da base escolhida. */
export function perSessionByBasis(summary: Pick<InfraCostSummary, 'perSession'>, basis: InfraCostSplitBasis) {
  return basis === 'connected' ? summary.perSession.connected : summary.perSession.contracted;
}

/** Avisos que se resolvem na aba Preços. */
const PRICE_WARNING_CODES = new Set<InfraCostWarningCode>([
  'config_drift', 'plan_without_price', 'storage_to_confirm', 'model_without_price', 'fx_missing', 'missing_hours',
]);

/** Campo do `config_drift` (nome da leitura) → caminho do campo no cadastro, para o rótulo de `fieldLabel`. */
const DRIFT_FIELD_PATH: Record<string, string> = { plan: 'monthlyUsd', instances: 'quantity', diskGb: 'storage.gb' };

export function isPriceWarning(code: InfraCostWarningCode): boolean {
  return PRICE_WARNING_CODES.has(code);
}

/**
 * Detalhe legível do aviso: item pelo rótulo (por `key` ou pelo recurso medido), campo pelo nome
 * (`storage.gb` → "Disco (GB)"), plano, modelo e contagem. Sem detalhe → `null`.
 */
export function warningDetail(w: InfraCostWarning, items: readonly LabeledItem[]): string | null {
  const d = S.summary.warningDetail;
  const id = w.key ?? w.resourceKey;
  const item = w.key
    ? items.find((i) => i.key === w.key)
    : w.resourceKey ? items.find((i) => i.renderKey === w.resourceKey) : undefined;
  const name = item?.label || (w.resourceKey && !w.key ? S.renderKey[w.resourceKey as InfraRenderKey] : undefined) || id;
  const field = w.code === 'config_drift' && w.field ? DRIFT_FIELD_PATH[w.field] ?? w.field : w.field;
  const parts = [
    name && field
      ? labelOf(`items[${item?.key ?? id}].${field}`, null, item ? [item] : [{ key: id!, label: name }])
      : name ? d.resource(name) : field ? d.field(ROW_FIELD_NAMES[field] ?? field) : null,
    w.plan ? d.plan(w.plan) : null,
    w.model ? d.model(w.model) : null,
    typeof w.count === 'number' ? (w.code === 'missing_hours' ? d.hours(w.count) : d.count(w.count)) : null,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** Nome do plano do catálogo do painel (`lite`) igual ao da tabela (`planName` do slug do domínio). */
export function catalogPlanName(slug: PlanSlug): string {
  const domain = Object.keys(planEntitlementsAdminStrings.planName).find((k) => toPanelPlanSlug(k) === slug);
  return domain ? planName(domain) : PLAN_CATALOG.find((p) => p.slug === slug)?.name ?? slug;
}
