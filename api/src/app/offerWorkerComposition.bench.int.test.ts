import { appendFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { OfferDispatchWorker } from '../modules/campaigns/infrastructure/worker/OfferDispatchWorker';
import { ProcessDueOfferDispatchesUseCase } from '../modules/campaigns/application/use-cases/ProcessDueOfferDispatchesUseCase';
import { PrismaOfferRepository } from '../modules/campaigns/infrastructure/repositories/PrismaOfferRepository';
import { PrismaOfferDispatchRepository } from '../modules/campaigns/infrastructure/repositories/PrismaOfferDispatchRepository';
import { ProcessPendingCapturedOffersUseCase } from '../modules/automation/application/use-cases/ProcessPendingCapturedOffersUseCase';
import { PrismaCapturedOfferRepository } from '../modules/automation/infrastructure/repositories/PrismaCapturedOfferRepository';
import { PrismaGroupMonitorRepository } from '../modules/automation/infrastructure/repositories/PrismaGroupMonitorRepository';
import type { IOfferQueue } from '../modules/automation/domain/contracts/IMonitorPorts';
import { jobsFor } from './processJobs';
import { buildOfferWorkerOptions } from './offerWorkerComposition';

/**
 * Benchmark sintético REDUZIDO da entrega A (T5) e B (T8, `OFFER_WORKER_BENCH_MODES=stages,concurrent`):
 * flag false × true (ou concorrência 1 × 2), mesma carga, banco LOCAL
 * descartável. Use cases reais de envio e captura com repositórios Prisma reais; rede, marketplace,
 * fila de oferta e WhatsApp são dublês com latência fixa. Nunca gera mensagem real.
 *
 * Só roda com OFFER_WORKER_BENCH=1 (fora do `pnpm test:int` normal):
 *   OFFER_WORKER_BENCH=1 OFFER_WORKER_BENCH_SECONDS=120 OFFER_WORKER_BENCH_OUT=/caminho/bench.jsonl \
 *   INTEGRATION_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<banco-isolado> \
 *   pnpm exec vitest run --config vitest.int.config.mts --project db src/app/offerWorkerComposition.bench.int.test.ts
 *
 * O claim de envio/captura é global (sem tenant): usar um banco só do benchmark, nunca o de outros testes.
 * Resultado impresso como JSON (`BENCH_RESULT`); registro em .specs/features/monitoring-queue-isolation/validation.md.
 */
const ENABLED = process.env['OFFER_WORKER_BENCH'] === '1';
const SECONDS = Number(process.env['OFFER_WORKER_BENCH_SECONDS'] ?? '120');
const REPS = Number(process.env['OFFER_WORKER_BENCH_REPS'] ?? '3');
type Mode = 'legacy' | 'stages' | 'concurrent';
/** Modos comparados (padrão A: legacy,stages). B: `stages,concurrent` (= etapas com OFFER_DISPATCH_CONCURRENCY 1 × 2). */
const MODES = (process.env['OFFER_WORKER_BENCH_MODES'] ?? 'legacy,stages').split(',').map((m) => m.trim()) as Mode[];
/** Arquivo JSONL com cada rodada e o resumo (opcional; sempre também no stdout). */
const OUT = process.env['OFFER_WORKER_BENCH_OUT'];
const emit = (line: string) => {
  process.stdout.write(`${line}\n`);
  if (OUT) appendFileSync(OUT, `${line}\n`);
};
const SESSIONS = 5;
const TARGETS_PER_SESSION = 2;
/** Capturas novas por segundo (todas as sessões). */
const CAPTURES_PER_SECOND = 2;
const LINK_MS = 250;
const SEND_MS = 300;
/** A cada N envios, um envio lento (I/O preso) de SLOW_SEND_MS. */
const SLOW_EVERY = 10;
const SLOW_SEND_MS = 15_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const p95 = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!;
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : null;
};

interface RunResult {
  mode: Mode;
  rep: number;
  captureRuns: number;
  dispatchRuns: number;
  captureStageP95Ms: number | null;
  dispatchStageP95Ms: number | null;
  captureWaitP95Ms: number | null;
  capturesQueued: number;
  sends: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  rssP95Mb: number;
  rssMaxMb: number;
  queries: number;
  queryP95Ms: number | null;
}

describe.skipIf(!ENABLED)('benchmark A — etapas independentes (sintético reduzido)', () => {
  const url = process.env['INTEGRATION_DATABASE_URL']!;
  const db = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
  const queryDurations: number[] = [];
  let counting = false;
  db.$on('query', (e) => {
    if (counting) queryDurations.push(e.duration);
  });
  const results: RunResult[] = [];

  beforeAll(async () => {
    await db.$connect();
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  async function seedTenant(tag: string) {
    const tenant = await db.tenant.create({ data: { name: 'bench', slug: `bench-offers-${tag}-${Date.now()}` } });
    const sessions: { sessionId: string; configId: string }[] = [];
    for (let i = 0; i < SESSIONS; i++) {
      const s = await db.session.create({ data: { tenantId: tenant.id, name: `S${i}`, status: 'CONNECTED' } });
      const cfg = await db.groupMonitorConfig.create({
        data: {
          tenantId: tenant.id, sessionId: s.id, enabled: true, windowStartMinute: 0, windowEndMinute: 1440,
          intervalMinSeconds: 0, intervalMaxSeconds: 0, maxOfferAgeMinutes: 600,
        },
      });
      for (let j = 0; j < TARGETS_PER_SESSION; j++) {
        const conv = await db.chatConversation.create({ data: { tenantId: tenant.id, sessionId: s.id, isGroup: true, groupJid: `g${i}-${j}` } });
        await db.broadcastGroup.create({
          data: { tenantId: tenant.id, sessionId: s.id, configId: cfg.id, conversationId: conv.id, groupJid: `g${i}-${j}`, position: j },
        });
      }
      sessions.push({ sessionId: s.id, configId: cfg.id });
    }
    return { tenantId: tenant.id, sessions };
  }

  async function cleanup(tenantId: string) {
    await db.offerDispatch.deleteMany({ where: { tenantId } });
    await db.capturedOffer.deleteMany({ where: { tenantId } });
    await db.offer.deleteMany({ where: { tenantId } });
    await db.broadcastGroup.deleteMany({ where: { tenantId } });
    await db.groupMonitorConfig.deleteMany({ where: { tenantId } });
    await db.chatConversation.deleteMany({ where: { tenantId } });
    await db.session.deleteMany({ where: { tenantId } });
    await db.tenant.delete({ where: { id: tenantId } });
  }

  async function runOnce(mode: Mode, rep: number): Promise<RunResult> {
    const { tenantId, sessions } = await seedTenant(`${mode}-${rep}`);
    const captured = new PrismaCapturedOfferRepository(db);
    const captureWaits: number[] = [];
    // Espera da captura: capturedAt → marcação (o que o envio preso atrasa no legado)
    const capturedTimed: typeof captured = Object.create(captured);
    capturedTimed.claimPending = async (limit, stale) => {
      const rows = await captured.claimPending(limit, stale);
      for (const r of rows) captureWaits.push(Date.now() - r.capturedAt.getTime());
      return rows;
    };
    let capturesQueued = 0;
    const queue: IOfferQueue = {
      async enqueue(input) {
        const offer = await db.offer.create({
          data: {
            tenantId: input.tenantId, provider: input.provider, sourceUrl: input.sourceUrl, affiliateUrl: input.affiliateUrl,
            text: input.text, status: 'SENDING', origin: 'MONITORING', sourceKey: input.sourceKey, expiresAt: input.expiresAt,
            monitorConfigId: input.monitorConfigId ?? null,
          },
        });
        await db.offerDispatch.createMany({
          data: input.destinations.map((d) => ({
            tenantId: input.tenantId, offerId: offer.id, conversationId: d.conversationId, sessionId: d.sessionId,
            notBefore: input.startAt, status: 'QUEUED' as const, gapSeconds: 0,
          })),
        });
        capturesQueued++;
        return { kind: 'queued', offerId: offer.id, firstSendAt: input.startAt };
      },
    };
    const captureUseCase = new ProcessPendingCapturedOffersUseCase({
      captured: capturedTimed,
      monitors: new PrismaGroupMonitorRepository(db),
      links: {
        async build(_t, href) {
          await sleep(LINK_MS);
          return { kind: 'ok', provider: 'AMAZON', sourceUrl: href, affiliateUrl: `${href}?tag=bench` };
        },
      },
      queue,
      entitlements: { getNumber: async () => 50, getBoolean: async () => true },
      products: { read: async () => ({ title: 'Produto', priceCents: 1000, originalPriceCents: null, imageUrl: null }) },
      texts: { compose: async () => ({ text: 'texto', aiFallback: false }) },
      images: { store: async () => null },
    });
    let sends = 0;
    const dispatchUseCase = new ProcessDueOfferDispatchesUseCase({
      offers: new PrismaOfferRepository(db),
      dispatches: new PrismaOfferDispatchRepository(db),
      sender: {
        async send() {
          sends++;
          await sleep(sends % SLOW_EVERY === 0 ? SLOW_SEND_MS : SEND_MS);
          return { chatMessageId: `bench-${sends}` };
        },
      },
    });

    const stageMs = { capture: [] as number[], dispatch: [] as number[] };
    const timed = <T extends { execute(ctx?: { signal?: AbortSignal }): Promise<{ processed: number }> }>(uc: T, bucket: number[]) => ({
      async execute(ctx?: { signal?: AbortSignal }) {
        const t0 = performance.now();
        try {
          return await uc.execute(ctx);
        } finally {
          bucket.push(performance.now() - t0);
        }
      },
    });
    const options = buildOfferWorkerOptions({
      jobs: jobsFor('worker'),
      flags: {
        offerDispatch: true, groupMonitoring: true, independentStages: mode !== 'legacy',
        dispatchConcurrency: mode === 'concurrent' ? 2 : 1,
      },
      runners: {
        offerDispatch: () => timed(dispatchUseCase, stageMs.dispatch),
        groupMonitoring: () => timed(captureUseCase, stageMs.capture),
      },
      onLegacyPartError: () => undefined,
    });
    const worker = new OfferDispatchWorker(options!);

    // Produtor: capturas novas a cada segundo, em rodízio pelas sessões
    let seq = 0;
    const producer = setInterval(() => {
      const rows = Array.from({ length: CAPTURES_PER_SECOND }, () => {
        const s = sessions[seq % sessions.length]!;
        seq++;
        return {
          tenantId, sessionId: s.sessionId, configId: s.configId, sourceExternalMessageId: `m-${seq}`,
          sourceText: `Oferta do dia ${seq} https://www.amazon.com.br/dp/B0${String(seq).padStart(8, '0')}`,
        };
      });
      void db.capturedOffer.createMany({ data: rows }).catch(() => undefined);
    }, 1_000);

    const rss: number[] = [];
    const rssSampler = setInterval(() => rss.push(process.memoryUsage().rss), 1_000);
    queryDurations.length = 0;
    counting = true;
    const cpu0 = process.cpuUsage();
    worker.start();
    await sleep(SECONDS * 1_000);
    clearInterval(producer);
    await worker.stop({ timeoutMs: 0 });
    const cpu = process.cpuUsage(cpu0);
    counting = false;
    clearInterval(rssSampler);
    // Envio lento ainda em voo termina antes da limpeza
    await sleep(SLOW_SEND_MS + 1_000);

    const result: RunResult = {
      mode, rep,
      captureRuns: stageMs.capture.length,
      dispatchRuns: stageMs.dispatch.length,
      captureStageP95Ms: round(p95(stageMs.capture)),
      dispatchStageP95Ms: round(p95(stageMs.dispatch)),
      captureWaitP95Ms: round(p95(captureWaits)),
      capturesQueued,
      sends,
      cpuUserMs: Math.round(cpu.user / 1000),
      cpuSystemMs: Math.round(cpu.system / 1000),
      rssP95Mb: Math.round((p95(rss) ?? 0) / 1048576),
      rssMaxMb: Math.round(Math.max(0, ...rss) / 1048576),
      queries: queryDurations.length,
      queryP95Ms: p95(queryDurations),
    };
    if (process.env['OFFER_WORKER_BENCH_KEEP'] !== '1') await cleanup(tenantId);
    return result;
  }

  function round(n: number | null) {
    return n == null ? null : Math.round(n);
  }

  it('flag false × true, repetições alternadas', async () => {
    for (let rep = 1; rep <= REPS; rep++) {
      for (const mode of MODES) {
        const r = await runOnce(mode, rep);
        results.push(r);
        emit(`BENCH_RUN ${JSON.stringify(r)}`);
      }
    }
    const summary = MODES.map((mode) => {
      const rs = results.filter((r) => r.mode === mode);
      const med = (k: keyof RunResult) => median(rs.map((r) => Number(r[k] ?? 0)));
      return {
        mode,
        captureRuns: med('captureRuns'), dispatchRuns: med('dispatchRuns'),
        captureStageP95Ms: med('captureStageP95Ms'), dispatchStageP95Ms: med('dispatchStageP95Ms'),
        captureWaitP95Ms: med('captureWaitP95Ms'), capturesQueued: med('capturesQueued'), sends: med('sends'),
        cpuMs: median(rs.map((r) => r.cpuUserMs + r.cpuSystemMs)), rssP95Mb: med('rssP95Mb'),
        queries: med('queries'), queryP95Ms: med('queryP95Ms'),
      };
    });
    emit(`BENCH_RESULT ${JSON.stringify({ seconds: SECONDS, reps: REPS, summary })}`);
    expect(results).toHaveLength(REPS * MODES.length);
  }, (SECONDS + 60) * 1000 * REPS * MODES.length + 60_000);
});
