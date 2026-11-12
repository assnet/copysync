import { OPS_METRIC } from '../OpsMetric';

/**
 * Instâncias vivas do serviço worker: CPU/RAM da Render (`srv-<id>-<sufixo>`) casadas com o batimento
 * por processo (`worker_heartbeats`). Dado de infraestrutura, sem tenant. Regra em docs/ops-metricas.md.
 */

/** Tolerância da "instância atual": amostra até 2 min antes da mais nova do serviço (mesmo corte do painel). */
export const WORKER_INSTANCE_CURRENT_SLACK_MS = 2 * 60_000;

export interface WorkerInstanceSample {
  resource: string;
  metric: string;
  value: number;
  at: Date;
}

export interface WorkerInstanceHeartbeat {
  workerId: string;
  sessions: number;
  pendingLogins: number;
  maxSessions: number;
  rssMb: number;
  seenAt: Date;
}

export interface WorkerInstanceRow {
  /** Nome curto: sufixo da instância (`4lx97`); `resource` inteiro se a Render não mandou sufixo. */
  instance: string;
  /** `srv-<id>-<sufixo>` da Render; `null` = batimento sem amostra atual. */
  resource: string | null;
  cpuPct: number | null;
  memoryPct: number | null;
  /** Amostra mais nova da instância (entre CPU e RAM). */
  sampledAt: Date | null;
  /** Batimento mais novo da instância; `null` = amostra sem batimento vivo. */
  heartbeat: WorkerInstanceHeartbeat | null;
}

/**
 * Segmentos do host no `workerId` (`<HOSTNAME>-<pid>-<nonce>`), sem o prefixo `<serviceId>-`. Na
 * Render o HOSTNAME é `srv-<id>-<hash>-<sufixo>`, então devolve `[hash, sufixo]`. Fora do serviço
 * (ou formato sem pid/nonce, ex. `WORKER_ID` manual) = `null`. Pura.
 */
export function workerIdHostSegments(workerId: string, serviceId: string): string[] | null {
  if (!workerId.startsWith(`${serviceId}-`)) return null;
  const segs = workerId.slice(serviceId.length + 1).split('-');
  if (segs.length < 3) return null;
  const host = segs.slice(0, -2).filter(Boolean);
  return host.length > 0 ? host : null;
}

/**
 * Casa amostras e batimentos por instância. Regras:
 * - Amostra: `resource` igual a `serviceId` ou `<serviceId>-<sufixo>`; só `cpu_pct`/`memory_pct`.
 *   Instância atual = amostra mais nova dela ≥ (mais nova do serviço − 2 min); a trocada por deploy sai.
 * - Batimento: casa com a instância cujo sufixo é um segmento **inteiro** do host no `workerId`
 *   (nunca substring: `4lx9` não casa `4lx97`). Vários batimentos na mesma instância (processo
 *   reiniciado ainda vivo) = vale o de `seenAt` mais novo.
 * - Batimento do serviço sem amostra atual vira linha só com batimento (nome = último segmento do host),
 *   inclusive o da instância cortada pelos 2 min (trocada por deploy ou métrica da Render atrasada): o
 *   batimento já vem filtrado pelo TTL de 90 s, então nenhuma sessão viva some da tela.
 *   Batimento fora do serviço (`all`, outro host) é ignorado.
 * Sem `serviceId` = lista vazia (sem worker separado). Ordem: nome curto. Pura.
 */
export function matchWorkerInstances(
  serviceId: string | null,
  samples: readonly WorkerInstanceSample[],
  heartbeats: readonly WorkerInstanceHeartbeat[],
  slackMs: number = WORKER_INSTANCE_CURRENT_SLACK_MS,
): WorkerInstanceRow[] {
  if (!serviceId) return [];
  const own = samples.filter((s) =>
    (s.metric === OPS_METRIC.cpuPct || s.metric === OPS_METRIC.memoryPct)
    && (s.resource === serviceId || s.resource.startsWith(`${serviceId}-`)));
  const newest = Math.max(-Infinity, ...own.map((s) => s.at.getTime()));

  type Acc = WorkerInstanceRow & { cpuAt?: number; memAt?: number };
  const rows = new Map<string, Acc>();
  for (const s of own) {
    const row: Acc = rows.get(s.resource) ?? {
      instance: s.resource === serviceId ? s.resource : s.resource.slice(serviceId.length + 1),
      resource: s.resource, cpuPct: null, memoryPct: null, sampledAt: null, heartbeat: null,
    };
    const prevAt = s.metric === OPS_METRIC.cpuPct ? row.cpuAt : row.memAt;
    if (prevAt && prevAt >= s.at.getTime()) continue;
    if (s.metric === OPS_METRIC.cpuPct) { row.cpuPct = s.value; row.cpuAt = s.at.getTime(); }
    else { row.memoryPct = s.value; row.memAt = s.at.getTime(); }
    if (!row.sampledAt || s.at > row.sampledAt) row.sampledAt = s.at;
    rows.set(s.resource, row);
  }
  for (const [k, r] of rows) if (r.sampledAt!.getTime() < newest - slackMs) rows.delete(k);

  const bySuffix = new Map<string, Acc>();
  for (const r of rows.values()) if (r.resource !== serviceId) bySuffix.set(r.instance, r);

  const orphans = new Map<string, Acc>();
  for (const hb of heartbeats) {
    const host = workerIdHostSegments(hb.workerId, serviceId);
    if (!host) continue;
    const target = host.map((seg) => bySuffix.get(seg)).find(Boolean)
      ?? orphans.get(host[host.length - 1])
      ?? <Acc>{ instance: host[host.length - 1], resource: null, cpuPct: null, memoryPct: null, sampledAt: null, heartbeat: null };
    if (!target.heartbeat || hb.seenAt > target.heartbeat.seenAt) target.heartbeat = { ...hb };
    if (!target.resource) orphans.set(target.instance, target);
  }

  return [...rows.values(), ...orphans.values()]
    .map(({ cpuAt: _c, memAt: _m, ...r }) => r)
    .sort((a, b) => a.instance.localeCompare(b.instance));
}
