import { env, type Env } from './env';
import { logger } from '../logger/logger';
import {
  INFRA_RENDER_KEYS,
  type InfraRenderKey,
} from '../../modules/metrics/domain/services/infraCostSettings';

/** Prefixo exigido do id por chave lógica: serviço web/worker/static = `srv-`, Postgres = `dpg-`, Key Value = `red-`. */
const PREFIX_BY_KEY: Record<InfraRenderKey, 'srv' | 'dpg' | 'red'> = {
  api: 'srv',
  worker: 'srv',
  static: 'srv',
  postgres: 'dpg',
  redis: 'red',
};

/** Serviço (`srv-`: api, worker, static): os únicos com banda e minutos de build lidos da Render. */
export function isInfraRenderServiceKey(key: InfraRenderKey): boolean {
  return PREFIX_BY_KEY[key] === 'srv';
}

/** Formato do id da Render (mesmo do escalador, com os três prefixos). */
export const INFRA_RENDER_ID_PATTERN = /^(srv|dpg|red)-[a-z0-9]+$/;

export type InfraCostRenderResources = ReadonlyMap<InfraRenderKey, string>;

export type InfraCostRenderResourcesIssue = 'malformed_entry' | 'unknown_key' | 'invalid_id' | 'duplicate_key';

interface IssueLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

const isKey = (v: string): v is InfraRenderKey => (INFRA_RENDER_KEYS as readonly string[]).includes(v);
const validFor = (key: InfraRenderKey, id: string) =>
  INFRA_RENDER_ID_PATTERN.test(id) && id.startsWith(`${PREFIX_BY_KEY[key]}-`);

/**
 * Parse de `INFRA_COST_RENDER_RESOURCES="api=srv-…,worker=srv-…,redis=red-…,postgres=dpg-…,static=srv-…"`.
 * Entrada malformada, chave fora da lista, id fora do formato/prefixo da chave ou chave repetida é ignorada
 * com `warn` — só o motivo e a chave lógica conhecida, nunca o id nem o texto cru. Sem `worker=`, usa
 * `WORKER_SCALER_SERVICE_ID` quando válido. Nunca lança: env errada não derruba o boot.
 */
export function parseInfraCostRenderResources(
  raw: string | undefined,
  workerFallbackId: string | undefined,
  log: IssueLogger = logger,
): InfraCostRenderResources {
  const out = new Map<InfraRenderKey, string>();
  const warn = (issue: InfraCostRenderResourcesIssue, key?: InfraRenderKey) =>
    log.warn(
      { module: 'infraCostRenderResources', env: 'INFRA_COST_RENDER_RESOURCES', issue, ...(key ? { key } : {}) },
      'infra cost render resource entry ignored',
    );
  for (const part of (raw ?? '').split(',')) {
    const entry = part.trim();
    if (!entry) continue;
    const eq = entry.indexOf('=');
    if (eq <= 0) {
      warn('malformed_entry');
      continue;
    }
    const key = entry.slice(0, eq).trim().toLowerCase();
    const id = entry.slice(eq + 1).trim();
    if (!isKey(key)) {
      warn('unknown_key');
      continue;
    }
    if (!validFor(key, id)) {
      warn('invalid_id', key);
      continue;
    }
    if (out.has(key)) {
      warn('duplicate_key', key);
      continue;
    }
    out.set(key, id);
  }
  const fallback = workerFallbackId?.trim();
  if (!out.has('worker') && fallback && validFor('worker', fallback)) out.set('worker', fallback);
  return out;
}

/** Recursos do processo, lidos das envs já validadas (só o `worker` tem a env). */
export function infraCostRenderResources(
  source: Pick<Env, 'INFRA_COST_RENDER_RESOURCES' | 'WORKER_SCALER_SERVICE_ID'> = env,
): InfraCostRenderResources {
  return parseInfraCostRenderResources(source.INFRA_COST_RENDER_RESOURCES, source.WORKER_SCALER_SERVICE_ID);
}
