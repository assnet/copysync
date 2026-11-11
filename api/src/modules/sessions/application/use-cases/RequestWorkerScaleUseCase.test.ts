import { describe, it, expect, vi } from 'vitest';
import { RequestWorkerScaleUseCase } from './RequestWorkerScaleUseCase';
import { ScaleCooldownActiveError } from '../../../../shared/errors/internal/WorkerScalingErrors';

function setup(execute = vi.fn(async () => ({ event: {} as never, replayed: false }))) {
  const invalidate = vi.fn();
  const useCase = new RequestWorkerScaleUseCase({
    scale: { execute },
    connectedSessions: async () => 5,
    state: { invalidate },
  });
  return { useCase, execute, invalidate };
}

const input = (reason = '  pico  ') => ({ replicas: 3, reason, requestId: 'r1', actorUserId: 'u1' });

describe('RequestWorkerScaleUseCase', () => {
  it('passa o motivo sem espaços, trigger manual e conectadas; invalida o cache', async () => {
    const ctx = setup();
    await ctx.useCase.execute(input());
    expect(ctx.execute).toHaveBeenCalledWith(expect.objectContaining({ reason: 'pico', trigger: 'manual', connected: 5 }));
    expect(ctx.invalidate).toHaveBeenCalledTimes(1);
  });

  it('invalida o cache também quando o pedido falha', async () => {
    const ctx = setup(vi.fn(async () => { throw new ScaleCooldownActiveError(new Date()); }));
    await expect(ctx.useCase.execute(input())).rejects.toMatchObject({ code: 'SCALE_COOLDOWN_ACTIVE' });
    expect(ctx.invalidate).toHaveBeenCalledTimes(1);
  });

  it.each(['   ab   ', `  ${'x'.repeat(201)}  `])('motivo fora de 3–200 depois do trim → INVALID_SCALE_REASON', async (reason) => {
    const ctx = setup();
    await expect(ctx.useCase.execute(input(reason))).rejects.toMatchObject({
      code: 'INVALID_SCALE_REASON',
      statusCode: 400,
      meta: { field: 'reason', min: 3, max: 200 },
    });
    expect(ctx.execute).not.toHaveBeenCalled();
  });

  it('motivo com 200 caracteres depois do trim passa', async () => {
    const ctx = setup();
    await ctx.useCase.execute(input(` ${'x'.repeat(200)} `));
    expect(ctx.execute).toHaveBeenCalled();
  });
});
