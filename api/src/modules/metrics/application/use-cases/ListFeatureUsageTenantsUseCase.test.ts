import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateAuditLogInput, IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import { UsageMetricsCursorInvalidError, UsageMetricsReadUnavailableError } from '../../../../shared/errors/internal/UsageMetricsErrors';
import type { FeatureUsageQueryInput } from './GetFeatureUsageSummaryUseCase';
import { FEATURE_USAGE_TENANTS_PAGE_SIZE, ListFeatureUsageTenantsUseCase } from './ListFeatureUsageTenantsUseCase';
import { createFeatureUsageTenantCursor } from './featureUsageTenantCursor';
import { FakeClock, FakeFeatureUsageReader, FakeUsageReadGate, FakeUsageTenantDirectory, usageRow, usageTenant } from './featureUsageTestFakes';

const NOW = new Date('2026-11-17T15:00:00.000Z');
const INPUT: FeatureUsageQueryInput = {
  from: '2026-10-19',
  to: '2026-11-17',
  granularity: 'day',
  kinds: ['ACTION', 'AUTOMATIC'],
  tenantStatus: 'ACTIVE',
  includeInternal: false,
};
const BASE = { ...INPUT, featureKey: 'offer_generator', actorUserId: 'admin-1' };

class FakeAudit implements IAuditLogRepository {
  entries: CreateAuditLogInput[] = [];
  fail = false;
  async create(input: CreateAuditLogInput): Promise<void> {
    if (this.fail) throw new Error('db down');
    this.entries.push(input);
  }
}

/** 60 contas; usos em grupos de 3 para forçar empates. */
function setup() {
  const clock = new FakeClock();
  const ids = Array.from({ length: 60 }, (_, i) => `t${String(i).padStart(2, '0')}`);
  const rows = ids.flatMap((id, i) => [
    usageRow('2026-11-10', id, 'offer_generator', 'ACTION', Math.floor(i / 3) + 1),
    usageRow('2026-11-12', id, 'offer_generator', 'ACTION', 1),
  ]);
  rows.push(usageRow('2026-09-25', 't00', 'offer_generator', 'ACTION', 999)); // período anterior: fora
  const reader = new FakeFeatureUsageReader(rows, { offer_generator: '2026-01-01' }, clock);
  const directory = new FakeUsageTenantDirectory(
    ids.map((id, i) => usageTenant(id, i % 2 ? 'COPYSYNC_PRO' : 'NONE', 'SAVER_LITE')),
    new Map(ids.map((id) => [id, `Conta ${id}`])),
  );
  const gate = new FakeUsageReadGate(clock);
  const audit = new FakeAudit();
  const deps = { reader, directory, gate, audit, now: () => NOW };
  const useCase = new ListFeatureUsageTenantsUseCase(deps);
  return { reader, directory, gate, audit, useCase, deps };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ListFeatureUsageTenantsUseCase', () => {
  it('60 contas paginam 25/25/10 sem repetir nem pular, com empates de usos', async () => {
    const { useCase, directory } = setup();
    const p1 = await useCase.execute(BASE);
    const p2 = await useCase.execute({ ...BASE, cursor: p1.nextCursor! });
    const p3 = await useCase.execute({ ...BASE, cursor: p2.nextCursor! });
    expect([p1.items.length, p2.items.length, p3.items.length]).toEqual([25, 25, 10]);
    expect(p3.nextCursor).toBeNull();
    const all = [...p1.items, ...p2.items, ...p3.items];
    expect(new Set(all.map((i) => i.tenantId)).size).toBe(60);
    for (let i = 1; i < all.length; i += 1) {
      const a = all[i - 1]!;
      const b = all[i]!;
      expect(a.uses > b.uses || (a.uses === b.uses && a.tenantId < b.tenantId)).toBe(true);
    }
    expect(FEATURE_USAGE_TENANTS_PAGE_SIZE).toBe(25);
    // nomes só dos ids da página
    expect(directory.namesCalls.map((c) => c.length)).toEqual([25, 25, 10]);
    expect(all[0]).toEqual({
      tenantId: 't57', // empate em 21 com t58 e t59: tenantId asc
      tenantName: 'Conta t57',
      plan: 'COPYSYNC_PRO',
      status: 'ACTIVE',
      internal: false,
      uses: 21,
      activeDays: 2,
      lastUsedDay: '2026-11-12',
    });
  });

  it('plano do item é o da família do recurso', async () => {
    const { useCase } = setup();
    const out = await useCase.execute({ ...BASE, featureKey: 'offer_generator' });
    expect(new Set(out.items.map((i) => i.plan))).toEqual(new Set(['COPYSYNC_PRO', 'NONE']));
  });

  it('filtro de plano restringe as contas', async () => {
    const { useCase } = setup();
    const out = await useCase.execute({ ...BASE, plan: 'NONE' });
    expect(out.items.every((i) => i.plan === 'NONE')).toBe(true);
  });

  describe('cursor inválido', () => {
    it.each([
      ['de outro recurso', { featureKey: 'group_monitoring' }],
      ['de outro recorte', { plan: 'COPYSYNC_PRO' }],
      ['de outra conta filtrada', { tenantId: 't01' }],
    ] as const)('%s', async (_label, over) => {
      const { useCase } = setup();
      const p1 = await useCase.execute(BASE);
      await expect(useCase.execute({ ...BASE, ...over, cursor: p1.nextCursor! })).rejects.toBeInstanceOf(UsageMetricsCursorInvalidError);
    });

    it('adulterado', async () => {
      const { useCase } = setup();
      const p1 = await useCase.execute(BASE);
      const [key, signed] = p1.nextCursor!.split('~');
      const forged = `${Buffer.from(JSON.stringify({ u: 999, t: 't00' })).toString('base64url')}~${signed}`;
      expect(key).not.toBe(forged.split('~')[0]);
      await expect(useCase.execute({ ...BASE, cursor: forged })).rejects.toBeInstanceOf(UsageMetricsCursorInvalidError);
      await expect(useCase.execute({ ...BASE, cursor: 'lixo' })).rejects.toBeInstanceOf(UsageMetricsCursorInvalidError);
    });

    it('vencido', async () => {
      const { useCase } = setup();
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-17T15:00:00Z'));
      const p1 = await useCase.execute(BASE);
      vi.setSystemTime(new Date('2026-11-17T16:00:00Z'));
      await expect(useCase.execute({ ...BASE, cursor: p1.nextCursor! })).rejects.toBeInstanceOf(UsageMetricsCursorInvalidError);
    });

    it('cursor inválido não abre o gate', async () => {
      const { useCase, gate } = setup();
      const scopeless = createFeatureUsageTenantCursor('outro', { uses: 1, tenantId: 't00' });
      await expect(useCase.execute({ ...BASE, cursor: scopeless })).rejects.toBeInstanceOf(UsageMetricsCursorInvalidError);
      expect(gate.opened).toBe(0);
    });
  });

  it('auditoria só na primeira página, sem nome nem id de conta listada', async () => {
    const { useCase, audit } = setup();
    const p1 = await useCase.execute({ ...BASE, tenantId: 't59' });
    await useCase.execute(BASE).then((p) => useCase.execute({ ...BASE, cursor: p.nextCursor! }));
    expect(p1.items).toHaveLength(1);
    expect(audit.entries).toHaveLength(2);
    expect(audit.entries[0]).toMatchObject({
      userId: 'admin-1',
      action: 'USAGE_METRICS_VIEWED',
      meta: { kind: 'tenants', featureKey: 'offer_generator', count: 1 },
    });
    expect(audit.entries[0]!.meta!.filters).toMatchObject({ from: '2026-10-19', to: '2026-11-17', hasTenantFilter: true });
    const serialized = JSON.stringify(audit.entries);
    expect(serialized).not.toMatch(/t\d\d|Conta /);
  });

  it('falha da auditoria não derruba a leitura (log warn)', async () => {
    const { audit, deps } = setup();
    audit.fail = true;
    const warn = vi.fn();
    const withLog = new ListFeatureUsageTenantsUseCase({ ...deps, log: { warn } });
    const out = await withLog.execute(BASE);
    expect(out.items).toHaveLength(25);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ featureKey: 'offer_generator' }), 'usage metrics audit failed');
  });

  it('roda numa vaga do gate: pedido simultâneo recebe 503', async () => {
    const { useCase, reader, gate } = setup();
    let release!: () => void;
    reader.hold = new Promise((r) => (release = r));
    const first = useCase.execute(BASE);
    await expect(useCase.execute(BASE)).rejects.toBeInstanceOf(UsageMetricsReadUnavailableError);
    release();
    await first;
    expect(gate.busy).toBe(false);
    expect(gate.opened).toBe(1);
  });

  it('lê só o período atual do recurso, com o mesmo orçamento no leitor e no diretório', async () => {
    const { useCase, reader, directory, gate } = setup();
    reader.spendMs = 300;
    await useCase.execute(BASE);
    expect(reader.calls[0]!.from.toISOString()).toBe('2026-10-19T03:00:00.000Z');
    expect(reader.calls[0]!.featureKeys).toEqual(['offer_generator']);
    expect(reader.calls[0]!.budget).toBe(gate.budgets[0]);
    expect(directory.listBudgets).toEqual([1700]);
    expect(directory.namesBudgets).toEqual([1700]);
  });
});
