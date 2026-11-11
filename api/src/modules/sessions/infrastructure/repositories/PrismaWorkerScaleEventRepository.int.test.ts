import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import type { NewWorkerScaleEvent } from '../../domain/contracts/IWorkerScaleEventRepository';
import { PrismaWorkerScaleEventRepository } from './PrismaWorkerScaleEventRepository';

/** Eventos de escala (WSCALE-13) contra Postgres local. */
const repo = new PrismaWorkerScaleEventRepository(prisma);
const base: NewWorkerScaleEvent = { trigger: 'manual', actorUserId: 'u1', fromReplicas: 1, toReplicas: 2, reason: 'pico', outcome: 'requested' };
const DAY = 86_400_000;
const plant = (at: Date, outcome = 'requested', error: string | null = null) =>
  prisma.workerScaleEvent.create({ data: { ...base, at, outcome, error } });

beforeEach(async () => {
  await prisma.workerScaleEvent.deleteMany({});
});
afterAll(async () => {
  await prisma.workerScaleEvent.deleteMany({});
  await prisma.$disconnect();
});

describe('record / findByRequestId', () => {
  it('grava, devolve id e lê pelo requestId', async () => {
    const id = await repo.record({ ...base, requestId: 'r1' });
    const evt = await repo.findByRequestId('r1');
    expect(evt).toMatchObject({ ...base, id, requestId: 'r1', error: null });
    expect(Math.abs(evt!.at.getTime() - Date.now())).toBeLessThan(10_000);
    expect(await repo.findByRequestId('nada')).toBeNull();
  });

  it('job sem ator nem requestId; vários requestId nulos convivem', async () => {
    await repo.record({ ...base, trigger: 'auto', actorUserId: null });
    await repo.record({ ...base, trigger: 'auto', actorUserId: null, requestId: null });
    expect(await prisma.workerScaleEvent.count({ where: { requestId: null, actorUserId: null } })).toBe(2);
  });

  it('requestId repetido viola a unicidade', async () => {
    await repo.record({ ...base, requestId: 'dup' });
    await expect(repo.record({ ...base, requestId: 'dup' })).rejects.toThrow();
  });

  it('trunca reason e error em 200 caracteres', async () => {
    const id = await repo.record({ ...base, reason: 'a'.repeat(300), error: 'e'.repeat(250), requestId: 'long' });
    const evt = await repo.findByRequestId('long');
    expect(evt!.id).toBe(id);
    expect(evt!.reason).toHaveLength(200);
    expect(evt!.error).toHaveLength(200);
  });

  it('CHECK recusa trigger e outcome fora da lista', async () => {
    await expect(prisma.workerScaleEvent.create({ data: { ...base, outcome: 'ok' } })).rejects.toThrow();
    await expect(prisma.workerScaleEvent.create({ data: { ...base, trigger: 'cron' } })).rejects.toThrow();
  });
});

describe('updateOutcome', () => {
  it('troca o resultado e grava/limpa o erro truncado', async () => {
    const id = await repo.record({ ...base, requestId: 'u' });
    await repo.updateOutcome(id, 'failed', 'x'.repeat(220));
    expect(await repo.findByRequestId('u')).toMatchObject({ outcome: 'failed', error: 'x'.repeat(200) });
    await repo.updateOutcome(id, 'succeeded');
    expect(await repo.findByRequestId('u')).toMatchObject({ outcome: 'succeeded', error: null });
  });
});

describe('lastSucceededAt', () => {
  it('null sem eventos; considera requested e succeeded, ignora failed e rejected', async () => {
    expect(await repo.lastSucceededAt()).toBeNull();
    const t1 = new Date(Date.now() - 3 * 60_000);
    const t2 = new Date(Date.now() - 2 * 60_000);
    await plant(t1, 'succeeded');
    await plant(t2, 'requested');
    await plant(new Date(Date.now() - 60_000), 'failed');
    await plant(new Date(), 'rejected');
    expect((await repo.lastSucceededAt())?.getTime()).toBe(t2.getTime());
  });
});

describe('lastSucceededAt — falha incerta', () => {
  it.each(['SCALER_UNAVAILABLE:timeout', 'SCALER_UNAVAILABLE:upstream', 'SCALE_REQUEST_FAILED'])(
    'failed com %s conta; falhas certas não',
    async (error) => {
      const t1 = new Date(Date.now() - 3 * 60_000);
      const t2 = new Date(Date.now() - 2 * 60_000);
      await plant(t1, 'succeeded');
      await plant(t2, 'failed', error);
      await plant(new Date(Date.now() - 60_000), 'failed', 'SCALER_UNAVAILABLE:auth');
      await plant(new Date(Date.now() - 50_000), 'failed', 'SCALER_UNAVAILABLE:not_found');
      await plant(new Date(Date.now() - 40_000), 'failed', 'SCALER_RATE_LIMITED');
      await plant(new Date(), 'rejected', 'SCALE_REQUEST_FAILED');
      expect((await repo.lastSucceededAt())?.getTime()).toBe(t2.getTime());
    },
  );
});

describe('recordRequestedIfIdle', () => {
  const evt = { trigger: 'manual' as const, actorUserId: 'u1', fromReplicas: 1, toReplicas: 2, reason: 'pico' };

  it('grava requested fora do intervalo e bloqueia dentro dele com retryAt', async () => {
    const now = new Date();
    const first = await repo.recordRequestedIfIdle({ evt: { ...evt, requestId: 'a' }, cooldownSeconds: 600, now });
    expect(first).toEqual({ id: expect.any(Number) });
    expect(await repo.findByRequestId('a')).toMatchObject({ outcome: 'requested', error: null });
    const second = await repo.recordRequestedIfIdle({ evt: { ...evt, requestId: 'b' }, cooldownSeconds: 600, now });
    expect('blocked' in second).toBe(true);
    const row = await repo.findByRequestId('a');
    expect((second as { blocked: Date }).blocked.getTime()).toBe(row!.at.getTime() + 600_000);
    expect(await repo.findByRequestId('b')).toBeNull();
  });

  it('failed sem erro incerto e rejected não contam; intervalo vencido libera', async () => {
    await plant(new Date(Date.now() - 60_000), 'failed');
    await plant(new Date(Date.now() - 30_000), 'rejected');
    await plant(new Date(Date.now() - 700_000), 'succeeded');
    const res = await repo.recordRequestedIfIdle({ evt: { ...evt, requestId: 'c' }, cooldownSeconds: 600, now: new Date() });
    expect(res).toEqual({ id: expect.any(Number) });
  });

  it('failed incerto bloqueia com retryAt a partir dele; falha certa não', async () => {
    const t = new Date(Date.now() - 60_000);
    await plant(t, 'failed', 'SCALER_UNAVAILABLE:timeout');
    const res = await repo.recordRequestedIfIdle({ evt: { ...evt, requestId: 'd' }, cooldownSeconds: 600, now: new Date() });
    expect(res).toEqual({ blocked: new Date(t.getTime() + 600_000) });
    await prisma.workerScaleEvent.deleteMany({});
    await plant(t, 'failed', 'SCALER_UNAVAILABLE:auth');
    await plant(t, 'failed', 'SCALER_RATE_LIMITED');
    const ok = await repo.recordRequestedIfIdle({ evt: { ...evt, requestId: 'e' }, cooldownSeconds: 600, now: new Date() });
    expect(ok).toEqual({ id: expect.any(Number) });
  });

  it('dois pedidos concorrentes com requestId diferentes: só um grava', async () => {
    const now = new Date();
    const results = await Promise.all(
      ['x1', 'x2', 'x3', 'x4'].map((requestId) =>
        repo.recordRequestedIfIdle({ evt: { ...evt, requestId }, cooldownSeconds: 600, now }),
      ),
    );
    expect(results.filter((r) => 'id' in r)).toHaveLength(1);
    expect(results.filter((r) => 'blocked' in r)).toHaveLength(3);
    expect(await prisma.workerScaleEvent.count({ where: { outcome: 'requested' } })).toBe(1);
  });

  it('requestId já gravado devolve existing (antes do intervalo), sem gravar', async () => {
    await repo.record({ ...base, outcome: 'failed', requestId: 'dup2' });
    await plant(new Date(), 'succeeded'); // intervalo ocupado: o replay vence o bloqueio
    const res = await repo.recordRequestedIfIdle({ evt: { ...evt, requestId: 'dup2' }, cooldownSeconds: 600, now: new Date() });
    expect(res).toEqual({ existing: expect.objectContaining({ requestId: 'dup2', outcome: 'failed' }) });
    expect(await prisma.workerScaleEvent.count()).toBe(2);
  });

  it('dois pedidos concorrentes com o mesmo requestId: um grava, o outro recebe existing', async () => {
    const now = new Date();
    const results = await Promise.all(
      [0, 1].map(() => repo.recordRequestedIfIdle({ evt: { ...evt, requestId: 'same' }, cooldownSeconds: 600, now })),
    );
    const created = results.filter((r) => 'id' in r) as { id: number }[];
    const replayed = results.filter((r) => 'existing' in r) as { existing: { id: number } }[];
    expect(created).toHaveLength(1);
    expect(replayed).toHaveLength(1);
    expect(replayed[0]!.existing.id).toBe(created[0]!.id);
    expect(results.some((r) => 'blocked' in r)).toBe(false);
    expect(await prisma.workerScaleEvent.count()).toBe(1);
  });

  it('trunca por code point sem partir emoji', async () => {
    await repo.recordRequestedIfIdle({ evt: { ...evt, reason: '😀'.repeat(250), requestId: 'emoji' }, cooldownSeconds: 0, now: new Date() });
    expect((await repo.findByRequestId('emoji'))!.reason).toBe('😀'.repeat(200));
  });
});

describe('list', () => {
  it('pagina por id desc com nextBeforeId até o fim', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) ids.push(await repo.record({ ...base, requestId: `p${i}` }));
    const p1 = await repo.list({ limit: 2 });
    expect(p1.items.map((e) => e.id)).toEqual([ids[4], ids[3]]);
    expect(p1.nextBeforeId).toBe(ids[3]);
    const p2 = await repo.list({ beforeId: p1.nextBeforeId, limit: 2 });
    expect(p2.items.map((e) => e.id)).toEqual([ids[2], ids[1]]);
    const p3 = await repo.list({ beforeId: p2.nextBeforeId, limit: 2 });
    expect(p3.items.map((e) => e.id)).toEqual([ids[0]]);
    expect(p3.nextBeforeId).toBeNull();
  });

  it('lista vazia', async () => {
    expect(await repo.list({ limit: 10 })).toEqual({ items: [], nextBeforeId: null });
  });
});

describe('deleteOlderThan', () => {
  it('apaga só os anteriores ao corte, em lotes', async () => {
    for (let i = 0; i < 5; i++) await plant(new Date(Date.now() - (181 + i) * DAY));
    await plant(new Date(Date.now() - 179 * DAY));
    await plant(new Date());
    const deleted = await repo.deleteOlderThan(new Date(Date.now() - 180 * DAY), 2);
    expect(deleted).toBe(5);
    expect(await prisma.workerScaleEvent.count()).toBe(2);
    expect(await repo.deleteOlderThan(new Date(Date.now() - 180 * DAY))).toBe(0);
  });
});
