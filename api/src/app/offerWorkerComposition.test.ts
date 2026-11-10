import { describe, expect, it, vi } from 'vitest';
import { env, parseEnv } from '../shared/config/env';
import { jobsFor } from './processJobs';
import {
  buildOfferWorkerOptions,
  offerWorkerStopOptions,
  resolveDispatchConcurrency,
  OFFER_STAGE_DISPATCH,
  OFFER_STAGE_MONITORING,
  type OfferWorkerFlags,
} from './offerWorkerComposition';
import { SHUTDOWN_DEADLINE_MS, SHUTDOWN_TAIL_RESERVE_MS } from './shutdownBudget';

const runnable = (processed = 1) => ({ execute: vi.fn(async (_ctx?: { signal?: AbortSignal }) => ({ processed })) });

function build(role: 'all' | 'worker' | 'http', flags: Partial<OfferWorkerFlags>, onErr = vi.fn()) {
  const dispatch = runnable(2);
  const monitoring = runnable(3);
  const options = buildOfferWorkerOptions({
    jobs: jobsFor(role),
    flags: { offerDispatch: false, groupMonitoring: false, independentStages: false, ...flags },
    runners: { offerDispatch: () => dispatch, groupMonitoring: () => monitoring },
    onLegacyPartError: onErr,
  });
  return { options, dispatch, monitoring, onErr };
}

describe('OFFER_WORKER_INDEPENDENT_STAGES_ENABLED', () => {
  it('default false', () => {
    expect(env.OFFER_WORKER_INDEPENDENT_STAGES_ENABLED).toBe(false);
    const r = parseEnv({ ...process.env, OFFER_WORKER_INDEPENDENT_STAGES_ENABLED: undefined });
    expect(r.success && r.data.OFFER_WORKER_INDEPENDENT_STAGES_ENABLED).toBe(false);
  });

  it('só "true" liga', () => {
    const on = parseEnv({ ...process.env, OFFER_WORKER_INDEPENDENT_STAGES_ENABLED: 'true' });
    const other = parseEnv({ ...process.env, OFFER_WORKER_INDEPENDENT_STAGES_ENABLED: '1' });
    expect(on.success && on.data.OFFER_WORKER_INDEPENDENT_STAGES_ENABLED).toBe(true);
    expect(other.success && other.data.OFFER_WORKER_INDEPENDENT_STAGES_ENABLED).toBe(false);
  });
});

describe('buildOfferWorkerOptions — papéis e flags', () => {
  it('http nunca cria worker, com qualquer flag', () => {
    for (const independentStages of [false, true]) {
      expect(build('http', { offerDispatch: true, groupMonitoring: true, independentStages }).options).toBeNull();
    }
  });

  it('all/worker com as duas flags desligadas não criam worker', () => {
    for (const role of ['all', 'worker'] as const) {
      for (const independentStages of [false, true]) {
        expect(build(role, { independentStages }).options).toBeNull();
      }
    }
  });

  it('true: uma etapa por flag ligada, na ordem envio → capturas', () => {
    const names = (f: Partial<OfferWorkerFlags>) => {
      const o = build('worker', { ...f, independentStages: true }).options;
      return o && 'stages' in o ? o.stages.map((s) => s.name) : null;
    };
    expect(names({ offerDispatch: true, groupMonitoring: true })).toEqual([OFFER_STAGE_DISPATCH, OFFER_STAGE_MONITORING]);
    expect(names({ offerDispatch: true })).toEqual([OFFER_STAGE_DISPATCH]);
    expect(names({ groupMonitoring: true })).toEqual([OFFER_STAGE_MONITORING]);
    const all = build('all', { offerDispatch: true, independentStages: true }).options;
    expect(all && 'stages' in all).toBe(true);
  });

  it('true: repassa o ctx (sinal) ao use case', async () => {
    const { options, dispatch, monitoring } = build('worker', { offerDispatch: true, groupMonitoring: true, independentStages: true });
    if (!options || !('stages' in options)) throw new Error('esperava etapas');
    const ctx = { signal: new AbortController().signal };
    await expect(options.stages[0].run(ctx)).resolves.toEqual({ processed: 2 });
    await expect(options.stages[1].run(ctx)).resolves.toEqual({ processed: 3 });
    expect(dispatch.execute).toHaveBeenCalledWith(ctx);
    expect(monitoring.execute).toHaveBeenCalledWith(ctx);
  });

  it('false: tick legado sequencial, soma processados e respeita cada flag', async () => {
    const { options, dispatch, monitoring } = build('all', { offerDispatch: true, groupMonitoring: true });
    if (!options || !('tick' in options)) throw new Error('esperava legado');
    await expect(options.tick().execute()).resolves.toEqual({ processed: 5 });
    expect(dispatch.execute).toHaveBeenCalledWith();
    expect(monitoring.execute).toHaveBeenCalledWith();

    const only = build('worker', { groupMonitoring: true });
    if (!only.options || !('tick' in only.options)) throw new Error('esperava legado');
    await expect(only.options.tick().execute()).resolves.toEqual({ processed: 3 });
    expect(only.dispatch.execute).not.toHaveBeenCalled();
  });

  it('false: erro numa parte vira 0 e a outra segue', async () => {
    const onErr = vi.fn();
    const options = buildOfferWorkerOptions({
      jobs: jobsFor('worker'),
      flags: { offerDispatch: true, groupMonitoring: true, independentStages: false },
      runners: {
        offerDispatch: () => ({ execute: async () => { throw new Error('x'); } }),
        groupMonitoring: () => ({ execute: async () => ({ processed: 4 }) }),
      },
      onLegacyPartError: onErr,
    });
    if (!options || !('tick' in options)) throw new Error('esperava legado');
    await expect(options.tick().execute()).resolves.toEqual({ processed: 4 });
    expect(onErr).toHaveBeenCalledWith(OFFER_STAGE_DISPATCH, expect.any(Error));
  });

  it('factories são lazy: nenhum container tocado ao compor', () => {
    const offerDispatch = vi.fn(() => runnable());
    const groupMonitoring = vi.fn(() => runnable());
    for (const independentStages of [false, true]) {
      buildOfferWorkerOptions({
        jobs: jobsFor('all'),
        flags: { offerDispatch: true, groupMonitoring: true, independentStages },
        runners: { offerDispatch, groupMonitoring },
        onLegacyPartError: vi.fn(),
      });
    }
    expect(offerDispatch).not.toHaveBeenCalled();
    expect(groupMonitoring).not.toHaveBeenCalled();
  });
});

describe('OFFER_DISPATCH_CONCURRENCY na composição (entrega B)', () => {
  it('padrão 1: ctx do envio intocado, sem `concurrency`', async () => {
    const { options, dispatch } = build('worker', { offerDispatch: true, independentStages: true, dispatchConcurrency: 1 });
    if (!options || !('stages' in options)) throw new Error('esperava etapas');
    const ctx = { signal: new AbortController().signal };
    await options.stages[0].run(ctx);
    expect(dispatch.execute).toHaveBeenCalledWith(ctx);
  });

  it('2 com etapas: envio recebe concurrency 2; capturas não', async () => {
    const { options, dispatch, monitoring } = build('worker', { offerDispatch: true, groupMonitoring: true, independentStages: true, dispatchConcurrency: 2 });
    if (!options || !('stages' in options)) throw new Error('esperava etapas');
    const ctx = { signal: new AbortController().signal };
    await options.stages[0].run(ctx);
    await options.stages[1].run(ctx);
    expect(dispatch.execute).toHaveBeenCalledWith({ signal: ctx.signal, concurrency: 2 });
    expect(monitoring.execute).toHaveBeenCalledWith(ctx);
  });

  it('2 sem etapas independentes: erro de configuração explícito', () => {
    expect(() => build('worker', { offerDispatch: true, dispatchConcurrency: 2 })).toThrow(
      'OFFER_DISPATCH_CONCURRENCY=2 requires OFFER_WORKER_INDEPENDENT_STAGES_ENABLED=true',
    );
  });

  it('rejeita 0, 3, fração e NaN; ausente = 1', () => {
    for (const c of [0, 3, 1.5, Number.NaN]) {
      expect(() => resolveDispatchConcurrency({ independentStages: true, dispatchConcurrency: c })).toThrow('must be 1 or 2');
    }
    expect(resolveDispatchConcurrency({ independentStages: false })).toBe(1);
  });

  it('http não valida nem cria worker', () => {
    expect(build('http', { offerDispatch: true, dispatchConcurrency: 2 }).options).toBeNull();
  });

  it('env: padrão 1', () => {
    expect(env.OFFER_DISPATCH_CONCURRENCY).toBe(1);
  });
});

describe('offerWorkerStopOptions — orçamento do shutdown', () => {
  const FREE = SHUTDOWN_DEADLINE_MS - SHUTDOWN_TAIL_RESERVE_MS;

  it('legado: sem teto extra (comportamento de hoje)', () => {
    expect(offerWorkerStopOptions(false, 0)).toEqual({});
    expect(offerWorkerStopOptions(false, 25_000)).toEqual({});
  });

  it('etapas: orçamento restante antes da reserva de sockets/flush', () => {
    expect(offerWorkerStopOptions(true, 0)).toEqual({ timeoutMs: FREE });
    // keeper/adoção já gastaram 12 s
    expect(offerWorkerStopOptions(true, 12_000)).toEqual({ timeoutMs: FREE - 12_000 });
  });

  it('etapas: nunca invade a reserva (orçamento esgotado = 0)', () => {
    expect(offerWorkerStopOptions(true, FREE)).toEqual({ timeoutMs: 0 });
    expect(offerWorkerStopOptions(true, SHUTDOWN_DEADLINE_MS + 5_000)).toEqual({ timeoutMs: 0 });
  });
});
