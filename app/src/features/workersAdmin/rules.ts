/** Regras puras da tela de workers (sem React). */
import type {
  WorkerCapacityPlan,
  WorkerScalerMode,
  WorkerScaleStateView,
  WorkerScalingSettings,
  WorkerScalingSettingsChange,
  WorkerScalingSettingsDraft,
  WorkerScalingSettingsField,
} from './types';
import { PLAN_CATALOG } from '@/features/plans/catalog';
import { serverNow } from '@/services/serverClock';
import { workersAdminStrings } from './strings';

export type OccupancyLevel = 'ok' | 'warning' | 'full';

/** Ocupação em % (0–100, inteiro). Teto 0 conta como cheio se houver sessão. */
export function occupancyPercent(sessions: number, maxSessions: number): number {
  if (maxSessions <= 0) return sessions > 0 ? 100 : 0;
  return Math.min(100, Math.max(0, Math.round((sessions / maxSessions) * 100)));
}

/** Faixa de cor: até 79% ok, 80–99% atenção, 100% cheio. */
export function occupancyLevel(sessions: number, maxSessions: number): OccupancyLevel {
  const pct = occupancyPercent(sessions, maxSessions);
  if (pct >= 100) return 'full';
  return pct >= 80 ? 'warning' : 'ok';
}

/** Ordem da tabela: mais ocupado primeiro, empate pelo id. */
export function sortWorkers<T extends { workerId: string; sessions: number; maxSessions: number }>(list: T[]): T[] {
  return [...list].sort(
    (a, b) => occupancyPercent(b.sessions, b.maxSessions) - occupancyPercent(a.sessions, a.maxSessions)
      || a.workerId.localeCompare(b.workerId),
  );
}

/* ── Configuração de escala (WSCALE-01/07) ───────────────────────────── */

type NumericField = Exclude<WorkerScalingSettingsField, 'scalerMode'>;

/** Faixas aceitas pela API (WSCALE-01). `maxReplicas` também exige ≥ `minReplicas`. */
export const WORKER_SETTINGS_LIMITS: Record<NumericField, { min: number; max: number; integer: boolean }> = {
  maxSessionsPerWorker: { min: 1, max: 1000, integer: true },
  maxPendingLoginsPerWorker: { min: 1, max: 500, integer: true },
  alertOccupancyRatio: { min: 0.5, max: 0.95, integer: false },
  awaitingAlertSeconds: { min: 30, max: 3600, integer: true },
  minReplicas: { min: 1, max: 20, integer: true },
  maxReplicas: { min: 1, max: 20, integer: true },
  scaleUpSustainSeconds: { min: 300, max: 3600, integer: true },
  scaleCooldownSeconds: { min: 300, max: 86400, integer: true },
};

/** Ordem de exibição e de comparação dos campos. */
export const WORKER_SETTINGS_FIELDS: WorkerScalingSettingsField[] = [
  'maxSessionsPerWorker', 'maxPendingLoginsPerWorker', 'alertOccupancyRatio', 'awaitingAlertSeconds',
  'scalerMode', 'minReplicas', 'maxReplicas', 'scaleUpSustainSeconds', 'scaleCooldownSeconds',
];

const SCALER_MODES: WorkerScalerMode[] = ['off', 'manual', 'auto'];
const fmt = (n: number) => n.toLocaleString('pt-BR');

const DRAFT_NUMBER = /^\d+([.,]\d+)?$/;

/**
 * Número do rascunho. Texto aceito: dígitos com no máximo um `.` ou `,` (sem sinal, hexa, expoente).
 * Em campo inteiro, separador seguido de exatamente 3 dígitos é milhar ("1.000" → 1000).
 * Vazio/inválido → `null`.
 */
export function parseDraftNumber(value: number | string, integer = false): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = value.trim();
  if (!DRAFT_NUMBER.test(text)) return null;
  if (integer && /^\d+[.,]\d{3}$/.test(text)) return Number(text.replace(/[.,]/, ''));
  return Number(text.replace(',', '.'));
}

/** Erro por campo do rascunho; objeto vazio = válido. */
export function validateSettingsDraft(
  draft: WorkerScalingSettingsDraft,
): Partial<Record<WorkerScalingSettingsField, string>> {
  const e = workersAdminStrings.settings.errors;
  const errors: Partial<Record<WorkerScalingSettingsField, string>> = {};
  for (const field of Object.keys(WORKER_SETTINGS_LIMITS) as NumericField[]) {
    const raw = draft[field];
    if (typeof raw === 'string' && raw.trim() === '') { errors[field] = e.required; continue; }
    const lim = WORKER_SETTINGS_LIMITS[field];
    const n = parseDraftNumber(raw, lim.integer);
    if (n === null) errors[field] = e.number;
    else if (lim.integer && !Number.isInteger(n)) errors[field] = e.integer;
    else if (n < lim.min || n > lim.max) errors[field] = e.range(fmt(lim.min), fmt(lim.max));
  }
  if (!SCALER_MODES.includes(draft.scalerMode)) errors.scalerMode = e.scalerMode;
  if (!errors.minReplicas && !errors.maxReplicas) {
    const min = parseDraftNumber(draft.minReplicas, true) as number;
    const max = parseDraftNumber(draft.maxReplicas, true) as number;
    if (max < min) errors.maxReplicas = e.maxBelowMin;
  }
  return errors;
}

/** Converte rascunho válido no payload; chame só depois de `validateSettingsDraft` vazio. */
export function draftToSettings(draft: WorkerScalingSettingsDraft): WorkerScalingSettings {
  const out = { scalerMode: draft.scalerMode } as WorkerScalingSettings;
  for (const field of Object.keys(WORKER_SETTINGS_LIMITS) as NumericField[]) {
    out[field] = parseDraftNumber(draft[field], WORKER_SETTINGS_LIMITS[field].integer) as number;
  }
  return out;
}

/** Campos que mudam entre `before` e `after`, na ordem de exibição. */
export function diffSettings(
  before: WorkerScalingSettings,
  after: WorkerScalingSettings,
): WorkerScalingSettingsChange[] {
  return WORKER_SETTINGS_FIELDS
    .filter((field) => before[field] !== after[field])
    .map((field) => ({ field, from: before[field], to: after[field] }));
}

/** Valor no campo: número vindo da API com vírgula decimal (pt-BR) e sem milhar; texto digitado fica como está. */
export function formatDraftValue(value: number | string): string {
  return typeof value === 'number' ? value.toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: 10 }) : value;
}

/** `true` quando o rascunho do campo difere do valor gravado (texto inválido conta como alterado). */
export function isDraftFieldChanged(
  field: WorkerScalingSettingsField,
  draft: WorkerScalingSettingsDraft,
  saved: WorkerScalingSettings,
): boolean {
  if (field === 'scalerMode') return draft.scalerMode !== saved.scalerMode;
  return parseDraftNumber(draft[field], WORKER_SETTINGS_LIMITS[field].integer) !== saved[field];
}

/* ── Capacidade (WSCALE-07/10) ───────────────────────────────────────── */

/** Plano sem limite em algum canal: um tenant pode abrir sessões sem fim, então não há como projetar. */
export function isUnlimitedPlan(plan: WorkerCapacityPlan): boolean {
  return plan.whatsapp.unlimitedTenants > 0 || plan.telegram.unlimitedTenants > 0;
}

/** Sessões contratadas (WhatsApp + Telegram) pelo tenant médio do plano; `null` sem tenant ou plano ilimitado. */
export function avgContractedPerTenant(plan: WorkerCapacityPlan): number | null {
  if (plan.tenants <= 0 || isUnlimitedPlan(plan)) return null;
  return (plan.whatsapp.contracted + plan.telegram.contracted) / plan.tenants;
}

/**
 * "Cabem mais N clientes" do plano: folga ÷ sessões contratadas pelo tenant médio (para baixo).
 * `null` ("—") sem folga medida, sem tenant, plano ilimitado ou tenant médio sem sessão contratada.
 */
export function clientsThatFit(plan: WorkerCapacityPlan, headroom: number | null): number | null {
  const avg = avgContractedPerTenant(plan);
  if (headroom === null || !Number.isFinite(headroom) || avg === null || avg <= 0) return null;
  return Math.floor(Math.max(0, headroom) / avg);
}

/**
 * Confirmação reforçada do teto (WSCALE-07): só quando o teto novo passa do sugerido pela
 * medição ou quando não há sugestão (sem amostra ou rota de capacidade fora).
 */
export function needsStrongCapConfirm(nextCap: number, suggestedMaxSessions: number | null): boolean {
  return suggestedMaxSessions === null || nextCap > suggestedMaxSessions;
}

/** Posição do plano no catálogo do painel (`lite` casa `lite` ou `<prefixo>_LITE`); desconhecido e sem plano no fim. */
function planCatalogRank(planSlug: string | null): number {
  if (planSlug === null) return PLAN_CATALOG.length + 1;
  const slug = planSlug.toLowerCase();
  const i = PLAN_CATALOG.findIndex((p) => slug === p.slug || slug.endsWith(`_${p.slug}`));
  return i === -1 ? PLAN_CATALOG.length : i;
}

/** Linhas da tabela por plano na ordem do catálogo; empate (desconhecidos) mantém a ordem da API. */
export function sortPlansByCatalog<T extends { planSlug: string | null }>(plans: readonly T[]): T[] {
  return plans
    .map((p, i) => ({ p, i, r: planCatalogRank(p.planSlug) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.p);
}

// ── Aba Escala (WSCALE-14) ─────────────────────────────────────────────────

const sc = workersAdminStrings.scale;

export const SCALE_REASON_MIN = 3;
export const SCALE_REASON_MAX = 200;

/** Por que os pedidos estão desligados; `null` = liberados (o intervalo mínimo é tratado à parte). */
export type ScaleBlock = 'notReady' | 'modeOff' | 'notEnforced' | 'disk' | 'nativeAutoscaling';

export function scaleBlock(view: WorkerScaleStateView): ScaleBlock | null {
  if (view.settings.scalerMode === 'off') return 'modeOff';
  if (!view.enforced) return 'notEnforced';
  if (view.scaler.status !== 'ready') return 'notReady';
  if (view.scaler.hasDisk) return 'disk';
  if (view.scaler.autoscalingEnabled) return 'nativeAutoscaling';
  return null;
}

/** Intervalo mínimo ativo no relógio do servidor. */
export function cooldownActive(cooldownUntil: string | null, nowMs: number): boolean {
  if (!cooldownUntil) return false;
  const end = new Date(cooldownUntil).getTime();
  return Number.isFinite(end) && end > nowMs;
}

/** Tempo restante em minutos/horas, arredondado para cima ("menos de 1 min" no último minuto). */
export function formatScaleRemaining(seconds: number): string {
  if (seconds < 60) return sc.remaining.underMinute;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return sc.remaining.minutes(minutes);
  return sc.remaining.hours(Math.floor(minutes / 60), minutes % 60);
}

/** Erro do alvo no diálogo; `null` = válido. */
export function scaleTargetError(raw: number | string, current: number, min: number, max: number): string | null {
  const text = String(raw).trim();
  const n = Number(text);
  if (text === '' || !Number.isInteger(n) || n < min || n > max) return sc.dialog.targetRange(min, max);
  if (n === current) return sc.dialog.targetSame;
  return null;
}

/** Erro do motivo (contado sem espaços nas pontas, como a API); `null` = válido. */
export function scaleReasonError(reason: string): string | null {
  const n = reason.trim().length;
  if (n < SCALE_REASON_MIN) return sc.dialog.reasonShort;
  if (n > SCALE_REASON_MAX) return sc.dialog.reasonLong;
  return null;
}

const fmtNum = (v: unknown, digits = 0) =>
  (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('pt-BR', { maximumFractionDigits: digits }) : '—');

const fmtWhen = (iso: unknown): string | null => {
  if (typeof iso !== 'string') return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

/** Mensagem clara para o erro do `POST /admin/workers/scale` (código e `meta` da API). */
/**
 * Espera de um 429: `meta.retryAfterSeconds` (provedor), depois o header `Retry-After` (segundos
 * ou data HTTP, contra o relógio do servidor) e por fim `meta.retryAt` (ISO).
 */
function rateLimitedMessage(m: Record<string, unknown>, retryAfter: unknown, now: number): string {
  const e2 = sc.requestErrors;
  if (typeof m.retryAfterSeconds === 'number' && m.retryAfterSeconds > 0) return e2.rateLimited(Math.ceil(m.retryAfterSeconds));
  if (typeof retryAfter === 'string' && retryAfter.trim()) {
    const raw = retryAfter.trim();
    if (/^\d+$/.test(raw)) {
      const secs = Number(raw);
      if (secs > 0) return e2.rateLimited(secs);
    } else {
      const at = Date.parse(raw);
      if (!Number.isNaN(at)) {
        const secs = Math.ceil((at - now) / 1000);
        if (secs > 0) return e2.rateLimited(secs);
      }
    }
  }
  const when = fmtWhen(m.retryAt);
  return when ? e2.rateLimitedAt(when) : e2.rateLimited(null);
}

/** Erros de evento `failed` com resultado incerto (espelha `UNCERTAIN_SCALE_FAILURE_ERRORS` da API). */
export const UNCERTAIN_SCALE_EVENT_ERRORS: readonly string[] = [
  'SCALER_UNAVAILABLE:timeout', 'SCALER_UNAVAILABLE:upstream', 'SCALE_REQUEST_FAILED',
];

/**
 * Falha depois do pedido ao provedor sem saber se ele aplicou: `SCALE_REQUEST_FAILED` ou
 * `meta.uncertain` (timeout/5xx no `scaleTo`). O intervalo mínimo já conta a partir do pedido.
 * `SCALER_UNAVAILABLE` sem `uncertain` é recusa antes da chamada: nada foi alterado.
 */
export function isUncertainScaleError(err: unknown): boolean {
  const e = (err ?? {}) as { code?: string; meta?: Record<string, unknown> };
  return e.code === 'SCALE_REQUEST_FAILED' || (e.code === 'SCALER_UNAVAILABLE' && e.meta?.uncertain === true);
}

export function scaleRequestErrorMessage(err: unknown, now: number = serverNow()): string {
  const e = (err ?? {}) as { status?: number; code?: string; meta?: Record<string, unknown>; retryAfter?: unknown };
  const m = e.meta ?? {};
  const e2 = sc.requestErrors;
  if (isUncertainScaleError(e)) return e2.uncertain;
  switch (e.code) {
    case 'REQUEST_ID_REUSED': return e2.requestIdReused;
    case 'SCALE_TARGET_OUT_OF_RANGE':
      return typeof m.min === 'number' && typeof m.max === 'number' ? e2.outOfRange(m.min, m.max) : e2.invalid;
    case 'SCALER_MODE_OFF': return e2.modeOff;
    case 'ADOPTION_DISABLED': return e2.adoptionDisabled;
    case 'SCALER_NOT_CONFIGURED':
      return e2.notConfigured(Array.isArray(m.missing) ? m.missing.filter((x) => typeof x === 'string').join(', ') : '');
    case 'SCALE_COOLDOWN_ACTIVE': return e2.cooldown(fmtWhen(m.retryAt));
    case 'SCALE_TARGET_UNCHANGED': return e2.unchanged(typeof m.replicas === 'number' ? m.replicas : null);
    case 'SCALE_DOWN_WOULD_EXCEED_CAPACITY':
      if (typeof m.replicas !== 'number' || typeof m.capacity !== 'number' || typeof m.connected !== 'number') return e2.wouldExceedShort;
      return e2.wouldExceed({
        replicas: fmtNum(m.replicas), maxSessionsPerWorker: fmtNum(m.maxSessionsPerWorker), ratio: fmtNum(m.ratio, 2),
        capacity: fmtNum(m.capacity), connected: fmtNum(m.connected),
      });
    case 'SCALER_SERVICE_NOT_SCALABLE':
      return (typeof m.reason === 'string' && e2.notScalable[m.reason]) || e2.notScalableGeneric;
    case 'SCALER_UNAVAILABLE': return e2.unavailable;
    case 'SCALER_RATE_LIMITED': return rateLimitedMessage(m, e.retryAfter, now);
    default:
      if (e.status === 429) return rateLimitedMessage(m, e.retryAfter, now);
      return e.status === 400 ? e2.invalid : e2.generic;
  }
}

/**
 * Erro gravado num evento `failed` (`CODIGO` ou `CODIGO:motivo`, ex.: `SCALER_UNAVAILABLE:timeout`)
 * traduzido com as mesmas mensagens do pedido; resultado incerto = `uncertain`; código desconhecido
 * cai no texto de falha genérico.
 */
export function scaleEventErrorMessage(error: string | null): string {
  if (!error) return sc.requestErrors.failedGeneric;
  if (UNCERTAIN_SCALE_EVENT_ERRORS.includes(error)) return sc.requestErrors.uncertain;
  const [code, reason] = error.split(':', 2);
  const known = scaleRequestErrorMessage({ code, meta: reason ? { reason } : {} });
  return known === sc.requestErrors.generic ? sc.requestErrors.failedGeneric : known;
}

/** Passo de ±1 réplica só vale se o alvo cair dentro de `[min, max]`. */
export function scaleStepAllowed(current: number, step: 1 | -1, min: number, max: number): boolean {
  const target = current + step;
  return target >= min && target <= max;
}

/** Alvo inicial de "Escolher alvo": vizinho dentro da faixa, ou a ponta mais perto se o atual está fora. */
export function defaultScaleTarget(current: number, min: number, max: number): number {
  if (current < min) return min;
  if (current > max) return max;
  if (current + 1 <= max) return current + 1;
  return current - 1;
}
