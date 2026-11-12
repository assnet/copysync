/**
 * Configuração de custos da infraestrutura (COST-01/02): preços em USD, itens, workspace e cotação.
 * Funções puras, sem env nem I/O. O documento é sempre gravado inteiro (sem patch por campo):
 * a origem é `default` (sem linha ou linha inválida) ou `saved`.
 * Ver `.specs/features/infra-costs/spec.md`.
 */
import { AI_PROVIDER_KINDS, type AiProviderKind } from '../../../assistants/domain/enums/AiProviderKind';
import { InvalidInfraCostSettingsError } from '../../../../shared/errors/internal/InfraCostErrors';

export const INFRA_COST_CATEGORIES = [
  'compute',
  'database',
  'cache',
  'static',
  'storage',
  'ai',
  'email',
  'platform',
  'other',
] as const;
export type InfraCostCategory = (typeof INFRA_COST_CATEGORIES)[number];

/** `fixed` = US$/mês × quantidade; `per_instance` = US$/mês por instância; `usage` = total do mês. */
export const INFRA_COST_BILLINGS = ['fixed', 'per_instance', 'usage'] as const;
export type InfraCostBilling = (typeof INFRA_COST_BILLINGS)[number];

/** Liga o item ao snapshot por hora (P2). Nunca é id de recurso da Render. */
export const INFRA_RENDER_KEYS = ['api', 'worker', 'redis', 'postgres', 'static'] as const;
export type InfraRenderKey = (typeof INFRA_RENDER_KEYS)[number];

export const INFRA_COST_ALLOCATIONS = ['shared', 'excluded'] as const;
export type InfraCostAllocation = (typeof INFRA_COST_ALLOCATIONS)[number];

export const INFRA_RENDER_RESOURCE_TYPES = ['service', 'postgres', 'key_value'] as const;
export type InfraRenderResourceType = (typeof INFRA_RENDER_RESOURCE_TYPES)[number];

export const INFRA_FX_CLOSING_METHODS = ['last_business_day', 'month_average'] as const;
export type InfraFxClosingMethod = (typeof INFRA_FX_CLOSING_METHODS)[number];

export interface InfraCostStorage {
  /** Tamanho em GB; `null` = a confirmar. */
  gb: number | null;
  /** US$ por GB/mês; `null` = a confirmar. */
  usdPerGb: number | null;
}

export interface InfraCostItem {
  key: string;
  label: string;
  category: InfraCostCategory;
  billing: InfraCostBilling;
  /** Componente de computação/plano em US$/mês. */
  monthlyUsd: number;
  /** Quantidade manual (instâncias ou unidades). */
  quantity: number;
  storage: InfraCostStorage | null;
  renderKey: InfraRenderKey | null;
  planLabel: string | null;
  allocation: InfraCostAllocation;
  note: string | null;
}

export interface InfraRenderPlanPrice {
  resourceType: InfraRenderResourceType;
  /** Nome do plano como a Render devolve. */
  plan: string;
  monthlyUsd: number;
}

export interface InfraAiModelPrice {
  kind: AiProviderKind;
  model: string;
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
}

export interface InfraWorkspaceSettings {
  planLabel: string;
  /** Dia de início do ciclo (1–28; 1 = mês calendário). */
  cycleStartDay: number;
  includedBandwidthGb: number;
  includedBuildMinutes: number;
  bandwidthUsdPerGb: number;
  buildUsdPer1000Min: number;
  /** Manual vence a medição quando preenchido. */
  manualBandwidthGb: number | null;
  manualBuildMinutes: number | null;
}

export interface InfraFxOverride {
  /** BRL por USD (1–20, até 4 casas). */
  rate: number;
  /** Data de referência `YYYY-MM-DD`. */
  date: string;
}

export interface InfraFxSettings {
  auto: boolean;
  override: InfraFxOverride | null;
  closingMethod: InfraFxClosingMethod;
}

export interface InfraCostSettings {
  fx: InfraFxSettings;
  items: InfraCostItem[];
  renderPlanPrices: InfraRenderPlanPrice[];
  aiModelPrices: InfraAiModelPrice[];
  workspace: InfraWorkspaceSettings;
}

export type InfraCostSettingsSource = 'default' | 'saved';

export interface EffectiveInfraCostSettings {
  value: InfraCostSettings;
  origin: InfraCostSettingsSource;
}

export const INFRA_COST_LIMITS = {
  maxItems: 40,
  maxRenderPlanPrices: 60,
  maxAiModelPrices: 60,
  maxLabelLength: 80,
  maxNoteLength: 280,
  maxPlanNameLength: 60,
  maxModelLength: 120,
} as const;

const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
/** Chave só de dígitos é proibida: o caminho `items[2]` seria lido como índice no painel. */
const NUMERIC_ONLY = /^\d+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Valores iniciais (COST-02, decisões do dono). Conferir no painel da Render. */
const RENDER_NOTE = 'Conferir no painel da Render';

export const DEFAULT_INFRA_COST_SETTINGS: InfraCostSettings = {
  fx: { auto: true, override: null, closingMethod: 'last_business_day' },
  items: [
    item('api', 'API', 'compute', 'per_instance', 25, 1, { gb: 15, usdPerGb: 0.25 }, 'api', 'Standard 1 CPU/2 GB', RENDER_NOTE),
    item('worker', 'Worker', 'compute', 'per_instance', 25, 1, null, 'worker', 'Standard 1 CPU/2 GB', RENDER_NOTE),
    item('static', 'Painel (site estático)', 'static', 'fixed', 0, 1, null, 'static', 'Static Site', RENDER_NOTE),
    item('redis', 'Redis', 'cache', 'fixed', 20, 1, null, 'redis', 'Key Value 1 GB', RENDER_NOTE),
    item('postgres', 'PostgreSQL', 'database', 'fixed', 19, 1, { gb: 15, usdPerGb: 0.3 }, 'postgres', 'Basic 0.5 CPU/1 GB', RENDER_NOTE),
    item('email', 'E-mail', 'email', 'fixed', 23, 1, null, null, null, null),
    item('r2', 'Armazenamento de arquivos (R2)', 'storage', 'usage', 0, 1, null, null, null, null),
  ],
  renderPlanPrices: [
    { resourceType: 'service', plan: '0.5c-512mb', monthlyUsd: 7 },
    { resourceType: 'service', plan: '1c-2g', monthlyUsd: 25 },
    { resourceType: 'service', plan: '2c-4g', monthlyUsd: 85 },
    { resourceType: 'service', plan: '2c-8g', monthlyUsd: 135 },
    { resourceType: 'postgres', plan: '0.1c-256mb', monthlyUsd: 6 },
    { resourceType: 'postgres', plan: '0.5c-1g', monthlyUsd: 19 },
    { resourceType: 'postgres', plan: '1c-2g', monthlyUsd: 40 },
    { resourceType: 'postgres', plan: '1c-4g', monthlyUsd: 55 },
    { resourceType: 'postgres', plan: '2c-4g', monthlyUsd: 75 },
    { resourceType: 'key_value', plan: '1gb', monthlyUsd: 20 },
  ],
  aiModelPrices: [],
  workspace: {
    planLabel: 'Hobby',
    cycleStartDay: 1,
    includedBandwidthGb: 5,
    includedBuildMinutes: 500,
    bandwidthUsdPerGb: 0.15,
    buildUsdPer1000Min: 5,
    manualBandwidthGb: null,
    manualBuildMinutes: null,
  },
};

function item(
  key: string,
  label: string,
  category: InfraCostCategory,
  billing: InfraCostBilling,
  monthlyUsd: number,
  quantity: number,
  storage: InfraCostStorage | null,
  renderKey: InfraRenderKey | null,
  planLabel: string | null,
  note: string | null,
): InfraCostItem {
  return { key, label, category, billing, monthlyUsd, quantity, storage, renderKey, planLabel, allocation: 'shared', note };
}

// ── Parse ─────────────────────────────────────────────────────────────────────

type Raw = Record<string, unknown>;

function fail(field: string, reason: string): never {
  throw new InvalidInfraCostSettingsError(field, reason);
}

/** Objeto com exatamente `fields` (campo faltando ou desconhecido → erro com o `field`). */
function readObject(raw: unknown, field: string, fields: readonly string[]): Raw {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail(field, 'must be an object');
  const obj = raw as Raw;
  const prefix = field === 'settings' ? '' : `${field}.`;
  for (const key of Object.keys(obj)) {
    if (!fields.includes(key)) fail(`${prefix}${key}`, 'unknown field');
  }
  for (const key of fields) {
    if (!(key in obj)) fail(`${prefix}${key}`, 'is required');
  }
  return obj;
}

function readNumber(raw: unknown, field: string, min: number, max: number, opts: { integer?: boolean; decimals?: number } = {}): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) fail(field, 'must be a number');
  if (opts.integer && !Number.isInteger(raw)) fail(field, 'must be an integer');
  if (raw < min || raw > max) fail(field, `must be between ${min} and ${max}`);
  if (opts.decimals !== undefined) {
    const scale = 10 ** opts.decimals;
    if (Math.abs(Math.round(raw * scale) - raw * scale) > 1e-6) fail(field, `must have at most ${opts.decimals} decimal places`);
  }
  return raw;
}

function readNullableNumber(raw: unknown, field: string, min: number, max: number, opts: { integer?: boolean } = {}): number | null {
  return raw === null ? null : readNumber(raw, field, min, max, opts);
}

function readString(raw: unknown, field: string, maxLength: number): string {
  if (typeof raw !== 'string') fail(field, 'must be a string');
  const value = raw.trim();
  if (value.length === 0) fail(field, 'must not be empty');
  if (value.length > maxLength) fail(field, `must have at most ${maxLength} characters`);
  return value;
}

function readNullableString(raw: unknown, field: string, maxLength: number): string | null {
  if (raw === null) return null;
  if (typeof raw === 'string' && raw.trim().length === 0) return null;
  return readString(raw, field, maxLength);
}

function readEnum<T extends string>(raw: unknown, field: string, values: readonly T[]): T {
  if (typeof raw !== 'string' || !(values as readonly string[]).includes(raw)) {
    fail(field, `must be one of ${values.join(', ')}`);
  }
  return raw as T;
}

function readBoolean(raw: unknown, field: string): boolean {
  if (typeof raw !== 'boolean') fail(field, 'must be a boolean');
  return raw;
}

function readArray(raw: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(raw)) fail(field, 'must be an array');
  if (raw.length > max) fail(field, `must have at most ${max} entries`);
  return raw;
}

function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const FX_FIELDS = ['auto', 'override', 'closingMethod'] as const;
const OVERRIDE_FIELDS = ['rate', 'date'] as const;
const ITEM_FIELDS = [
  'key',
  'label',
  'category',
  'billing',
  'monthlyUsd',
  'quantity',
  'storage',
  'renderKey',
  'planLabel',
  'allocation',
  'note',
] as const;
const STORAGE_FIELDS = ['gb', 'usdPerGb'] as const;
const PLAN_PRICE_FIELDS = ['resourceType', 'plan', 'monthlyUsd'] as const;
const AI_PRICE_FIELDS = ['kind', 'model', 'inputPerMTokUsd', 'outputPerMTokUsd'] as const;
const WORKSPACE_FIELDS = [
  'planLabel',
  'cycleStartDay',
  'includedBandwidthGb',
  'includedBuildMinutes',
  'bandwidthUsdPerGb',
  'buildUsdPer1000Min',
  'manualBandwidthGb',
  'manualBuildMinutes',
] as const;
const SETTINGS_FIELDS = ['fx', 'items', 'renderPlanPrices', 'aiModelPrices', 'workspace'] as const;

function parseFx(raw: unknown): InfraFxSettings {
  const obj = readObject(raw, 'fx', FX_FIELDS);
  let override: InfraFxOverride | null = null;
  if (obj.override !== null) {
    const o = readObject(obj.override, 'fx.override', OVERRIDE_FIELDS);
    const rate = readNumber(o.rate, 'fx.override.rate', 1, 20, { decimals: 4 });
    if (typeof o.date !== 'string' || !isValidDate(o.date)) fail('fx.override.date', 'must be a date YYYY-MM-DD');
    override = { rate, date: o.date };
  }
  return {
    auto: readBoolean(obj.auto, 'fx.auto'),
    override,
    closingMethod: readEnum(obj.closingMethod, 'fx.closingMethod', INFRA_FX_CLOSING_METHODS),
  };
}

function parseItem(raw: unknown, index: number): InfraCostItem {
  const f = `items[${index}]`;
  const obj = readObject(raw, f, ITEM_FIELDS);
  if (typeof obj.key !== 'string' || !KEY_PATTERN.test(obj.key)) {
    fail(`${f}.key`, 'must be a slug (a-z, 0-9, "_" or "-", up to 40 characters)');
  }
  if (NUMERIC_ONLY.test(obj.key)) fail(`${f}.key`, 'must not be only digits');
  let storage: InfraCostStorage | null = null;
  if (obj.storage !== null) {
    const s = readObject(obj.storage, `${f}.storage`, STORAGE_FIELDS);
    storage = {
      gb: readNullableNumber(s.gb, `${f}.storage.gb`, 0, 10_000),
      usdPerGb: readNullableNumber(s.usdPerGb, `${f}.storage.usdPerGb`, 0, 10),
    };
  }
  return {
    key: obj.key,
    label: readString(obj.label, `${f}.label`, INFRA_COST_LIMITS.maxLabelLength),
    category: readEnum(obj.category, `${f}.category`, INFRA_COST_CATEGORIES),
    billing: readEnum(obj.billing, `${f}.billing`, INFRA_COST_BILLINGS),
    monthlyUsd: readNumber(obj.monthlyUsd, `${f}.monthlyUsd`, 0, 100_000),
    quantity: readNumber(obj.quantity, `${f}.quantity`, 0, 100, { integer: true }),
    storage,
    renderKey: obj.renderKey === null ? null : readEnum(obj.renderKey, `${f}.renderKey`, INFRA_RENDER_KEYS),
    planLabel: readNullableString(obj.planLabel, `${f}.planLabel`, INFRA_COST_LIMITS.maxLabelLength),
    allocation: readEnum(obj.allocation, `${f}.allocation`, INFRA_COST_ALLOCATIONS),
    note: readNullableString(obj.note, `${f}.note`, INFRA_COST_LIMITS.maxNoteLength),
  };
}

function parsePlanPrice(raw: unknown, index: number): InfraRenderPlanPrice {
  const f = `renderPlanPrices[${index}]`;
  const obj = readObject(raw, f, PLAN_PRICE_FIELDS);
  return {
    resourceType: readEnum(obj.resourceType, `${f}.resourceType`, INFRA_RENDER_RESOURCE_TYPES),
    plan: readString(obj.plan, `${f}.plan`, INFRA_COST_LIMITS.maxPlanNameLength),
    monthlyUsd: readNumber(obj.monthlyUsd, `${f}.monthlyUsd`, 0, 100_000),
  };
}

function parseAiPrice(raw: unknown, index: number): InfraAiModelPrice {
  const f = `aiModelPrices[${index}]`;
  const obj = readObject(raw, f, AI_PRICE_FIELDS);
  return {
    kind: readEnum(obj.kind, `${f}.kind`, AI_PROVIDER_KINDS),
    model: readString(obj.model, `${f}.model`, INFRA_COST_LIMITS.maxModelLength),
    inputPerMTokUsd: readNumber(obj.inputPerMTokUsd, `${f}.inputPerMTokUsd`, 0, 1_000),
    outputPerMTokUsd: readNumber(obj.outputPerMTokUsd, `${f}.outputPerMTokUsd`, 0, 1_000),
  };
}

function parseWorkspace(raw: unknown): InfraWorkspaceSettings {
  const obj = readObject(raw, 'workspace', WORKSPACE_FIELDS);
  return {
    planLabel: readString(obj.planLabel, 'workspace.planLabel', INFRA_COST_LIMITS.maxLabelLength),
    cycleStartDay: readNumber(obj.cycleStartDay, 'workspace.cycleStartDay', 1, 28, { integer: true }),
    includedBandwidthGb: readNumber(obj.includedBandwidthGb, 'workspace.includedBandwidthGb', 0, 100_000),
    includedBuildMinutes: readNumber(obj.includedBuildMinutes, 'workspace.includedBuildMinutes', 0, 1_000_000, { integer: true }),
    bandwidthUsdPerGb: readNumber(obj.bandwidthUsdPerGb, 'workspace.bandwidthUsdPerGb', 0, 10),
    buildUsdPer1000Min: readNumber(obj.buildUsdPer1000Min, 'workspace.buildUsdPer1000Min', 0, 1_000),
    manualBandwidthGb: readNullableNumber(obj.manualBandwidthGb, 'workspace.manualBandwidthGb', 0, 1_000_000),
    manualBuildMinutes: readNullableNumber(obj.manualBuildMinutes, 'workspace.manualBuildMinutes', 0, 10_000_000, { integer: true }),
  };
}

/** Primeiro índice repetido por `identity`; erro em `<list>[i].<field>`. */
function assertUnique<T>(list: readonly T[], identity: (entry: T) => string | null, field: (index: number) => string, what: string): void {
  const seen = new Set<string>();
  list.forEach((entry, index) => {
    const id = identity(entry);
    if (id === null) return;
    if (seen.has(id)) fail(field(index), `duplicate ${what}`);
    seen.add(id);
  });
}

/**
 * Valida o documento inteiro (COST-01). Rejeita campo desconhecido ou faltando, tipo errado,
 * valor fora da faixa, lista acima do limite, `key` repetida, `renderKey` repetida, plano e
 * modelo repetidos; sempre com o `field` (ex.: `items[2].storage.usdPerGb`). Sem coerção de tipo.
 */
export function parseInfraCostSettings(input: unknown): InfraCostSettings {
  const obj = readObject(input, 'settings', SETTINGS_FIELDS);
  const fx = parseFx(obj.fx);
  const items = readArray(obj.items, 'items', INFRA_COST_LIMITS.maxItems).map(parseItem);
  const renderPlanPrices = readArray(obj.renderPlanPrices, 'renderPlanPrices', INFRA_COST_LIMITS.maxRenderPlanPrices).map(parsePlanPrice);
  const aiModelPrices = readArray(obj.aiModelPrices, 'aiModelPrices', INFRA_COST_LIMITS.maxAiModelPrices).map(parseAiPrice);
  const workspace = parseWorkspace(obj.workspace);

  assertUnique(items, (i) => i.key, (n) => `items[${n}].key`, 'key');
  assertUnique(items, (i) => i.renderKey, (n) => `items[${n}].renderKey`, 'renderKey');
  assertUnique(renderPlanPrices, (p) => `${p.resourceType}:${p.plan}`, (n) => `renderPlanPrices[${n}].plan`, 'plan');
  assertUnique(aiModelPrices, (p) => `${p.kind}:${p.model}`, (n) => `aiModelPrices[${n}].model`, 'model');

  return { fx, items, renderPlanPrices, aiModelPrices, workspace };
}

/** Cópia profunda dos valores iniciais (quem recebe pode mutar sem afetar o default). */
export function defaultInfraCostSettings(): InfraCostSettings {
  return structuredClone(DEFAULT_INFRA_COST_SETTINGS);
}

/**
 * Valor efetivo (COST-02): sem linha ou linha inválida (gravada fora da API) → valores iniciais
 * com origem `default`, para a tela abrir e o admin regravar; senão o salvo com origem `saved`.
 */
export function resolveInfraCostSettings(saved: { value: unknown } | null): EffectiveInfraCostSettings {
  if (saved) {
    try {
      return { value: parseInfraCostSettings(saved.value), origin: 'saved' };
    } catch {
      // linha inválida vale como sem valor
    }
  }
  return { value: defaultInfraCostSettings(), origin: 'default' };
}
