import { describe, expect, it, vi } from 'vitest';
import type { FeatureUsageEvent, IFeatureUsageRecorder } from '../../domain/contracts/IFeatureUsageRecorder';
import { RecordPageViewUseCase } from './RecordPageViewUseCase';
import { RecordFeatureUsageUseCase } from './RecordFeatureUsageUseCase';

const AT = new Date('2026-11-20T02:30:00.000Z');
const flush = () => new Promise((r) => setTimeout(r, 0));

function recorder(fail = false) {
  const calls: { op: string; event: FeatureUsageEvent }[] = [];
  const r: IFeatureUsageRecorder = {
    increment: vi.fn(async (event) => void calls.push({ op: 'increment', event })),
    markOnce: vi.fn(async (event) => {
      calls.push({ op: 'markOnce', event });
      if (fail) throw new Error('db down');
    }),
  };
  return { r, calls };
}

describe('RecordPageViewUseCase', () => {
  it('marca uma vez por dia × conta × tela: só conta, chave, tipo e instante', async () => {
    const { r, calls } = recorder();
    new RecordPageViewUseCase({ recorder: r }).execute({ tenantId: 't1', isSuperAdmin: false, key: 'view:offers', at: AT });
    await flush();
    expect(calls).toEqual([{ op: 'markOnce', event: { tenantId: 't1', featureKey: 'view:offers', kind: 'ACCESS', at: AT } }]);
    expect(Object.keys(calls[0]!.event).sort()).toEqual(['at', 'featureKey', 'kind', 'tenantId']);
  });

  it('super admin não conta', async () => {
    const { r } = recorder();
    new RecordPageViewUseCase({ recorder: r }).execute({ tenantId: 't1', isSuperAdmin: true, key: 'view:offers', at: AT });
    await flush();
    expect(r.markOnce).not.toHaveBeenCalled();
  });

  it('chave fora da lista não grava', async () => {
    const { r } = recorder();
    new RecordPageViewUseCase({ recorder: r }).execute({ tenantId: 't1', isSuperAdmin: false, key: 'view:admin-usage', at: AT });
    await flush();
    expect(r.markOnce).not.toHaveBeenCalled();
  });

  it('falha do contador não lança e vira log', async () => {
    const { r } = recorder(true);
    const warn = vi.fn();
    expect(() => new RecordPageViewUseCase({ recorder: r, log: { warn } }).execute({ tenantId: 't1', isSuperAdmin: false, key: 'view:offers', at: AT })).not.toThrow();
    await flush();
    expect(warn).toHaveBeenCalledWith({ err: 'Error', featureKey: 'view:offers' }, 'page view count failed');
  });

  it('o contador real grava a tela (sem corte) no dia de Brasília', async () => {
    const markOnce = vi.fn(async () => undefined);
    const claimCutover = vi.fn(async () => '2026-11-19');
    const real = new RecordFeatureUsageUseCase({ daily: { increment: vi.fn(), markOnce }, cutovers: { claimCutover } });
    expect(await real.counts({ featureKey: 'view:offers', at: AT })).toBe(true);
    expect(await real.counts({ featureKey: 'view:nao-existe', at: AT })).toBe(false);
    new RecordPageViewUseCase({ recorder: real }).execute({ tenantId: 't1', isSuperAdmin: false, key: 'view:dashboard', at: AT });
    await flush();
    expect(markOnce).toHaveBeenCalledWith({ tenantId: 't1', featureKey: 'view:dashboard', kind: 'ACCESS', at: AT });
    expect(claimCutover).not.toHaveBeenCalled();
  });
});
