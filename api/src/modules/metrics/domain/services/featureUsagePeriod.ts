import { UsageMetricsRangeInvalidError } from '../../../../shared/errors/internal/UsageMetricsErrors';

/**
 * Período, fuso e buckets do "Uso dos recursos" (docs: .specs/features/usage-metrics, design §3/§5).
 * Dias são `YYYY-MM-DD` em Brasília; instantes são UTC. Puro: o relógio entra por parâmetro.
 */

export const USAGE_TIME_ZONE = 'America/Sao_Paulo';

export type UsageGranularity = 'day' | 'week' | 'month';

/** Bucket da série: `key` = início do calendário (o dia, a segunda-feira ou o dia 1); `from`/`to` = parte dentro do período. */
export interface UsageBucket {
  key: string;
  from: string;
  to: string;
}

export interface UsagePeriod {
  from: string;
  to: string;
  days: number;
  granularity: UsageGranularity;
  /** `[fromInstant, toExclusive)` em UTC. */
  fromInstant: Date;
  toExclusive: Date;
  previousFrom: string;
  previousTo: string;
  previousFromInstant: Date;
  buckets: UsageBucket[];
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function parseDay(day: string): number {
  if (!DAY_RE.test(day)) throw new UsageMetricsRangeInvalidError('invalid date format');
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    throw new UsageMetricsRangeInvalidError('invalid date');
  }
  return ms;
}

function formatDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Soma `n` dias (pode ser negativo) a um dia `YYYY-MM-DD`. */
export function addDays(day: string, n: number): string {
  return formatDay(parseDay(day) + n * DAY_MS);
}

/** Dias corridos de `from` a `to`, inclusivos. */
export function daysInclusive(from: string, to: string): number {
  return Math.round((parseDay(to) - parseDay(from)) / DAY_MS) + 1;
}

/**
 * Dia de Brasília (`YYYY-MM-DD`) de um **instante**. Recebe o `Date` de uma coluna `timestamp`, nunca de
 * um `date` (meia-noite UTC cairia no dia anterior).
 */
export function dayInZone(at: Date, timeZone = USAGE_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const v = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}

/** Deslocamento do fuso (ms) no instante: hora de parede − UTC. */
function offsetAt(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/** Instante UTC da meia-noite de `day` no fuso (recalcula o offset no chute: cobre horário de verão). */
export function startOfDayInstant(day: string, timeZone = USAGE_TIME_ZONE): Date {
  const midnightAsUtc = parseDay(day);
  let guess = midnightAsUtc - offsetAt(new Date(midnightAsUtc + 12 * 3_600_000), timeZone);
  guess = midnightAsUtc - offsetAt(new Date(guess), timeZone);
  return new Date(guess);
}

/** Chave do bucket que contém `day`: o próprio dia, a segunda-feira da semana ou o dia 1 do mês. */
export function bucketOf(day: string, granularity: UsageGranularity): string {
  if (granularity === 'day') return addDays(day, 0);
  if (granularity === 'month') return `${day.slice(0, 7)}-01`;
  const weekday = new Date(parseDay(day)).getUTCDay(); // 0 = domingo
  return addDays(day, -((weekday + 6) % 7));
}

function nextBucketKey(key: string, granularity: UsageGranularity): string {
  if (granularity === 'day') return addDays(key, 1);
  if (granularity === 'week') return addDays(key, 7);
  const [y, m] = key.split('-').map(Number) as [number, number];
  return formatDay(Date.UTC(y, m, 1));
}

/** Buckets contíguos cobrindo `[from, to]`, com as pontas recortadas ao período. */
export function usageBuckets(from: string, to: string, granularity: UsageGranularity): UsageBucket[] {
  const out: UsageBucket[] = [];
  for (let key = bucketOf(from, granularity); key <= to; key = nextBucketKey(key, granularity)) {
    const end = addDays(nextBucketKey(key, granularity), -1);
    out.push({ key, from: key < from ? from : key, to: end > to ? to : end });
  }
  return out;
}

/**
 * Valida e resolve o período pedido (`from`/`to` inclusivos, dias de Brasília) contra o relógio e o teto da
 * fonte. Período anterior = mesma duração, colado antes de `from`.
 */
export function resolveUsagePeriod(input: {
  from: string;
  to: string;
  granularity: UsageGranularity;
  now: Date;
  maxDays: number;
}): UsagePeriod {
  const { from, to, granularity, now, maxDays } = input;
  parseDay(from);
  parseDay(to);
  if (from > to) throw new UsageMetricsRangeInvalidError('from after to', maxDays);
  if (to > dayInZone(now)) throw new UsageMetricsRangeInvalidError('date in the future', maxDays);
  const days = daysInclusive(from, to);
  if (days > maxDays) throw new UsageMetricsRangeInvalidError(`range above ${maxDays} days`, maxDays);

  const previousTo = addDays(from, -1);
  const previousFrom = addDays(from, -days);
  return {
    from,
    to,
    days,
    granularity,
    fromInstant: startOfDayInstant(from),
    toExclusive: startOfDayInstant(addDays(to, 1)),
    previousFrom,
    previousTo,
    previousFromInstant: startOfDayInstant(previousFrom),
    buckets: usageBuckets(from, to, granularity),
  };
}

/**
 * Limite efetivo para comparação: o maior entre o primeiro dado e hoje menos a retenção da fonte.
 * `null` quando o recurso não tem dado.
 */
export function dataFromOf(firstDataDay: string | null, retentionDays: number | null | undefined, now: Date): string | null {
  if (firstDataDay === null) return null;
  if (!retentionDays) return firstDataDay;
  const retainedFrom = addDays(dayInZone(now), -retentionDays);
  return firstDataDay > retainedFrom ? firstDataDay : retainedFrom;
}
