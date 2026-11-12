import { describe, expect, it, vi } from 'vitest';
import { bootSessionsWithKeeper } from './sessionBootOrder';

describe('bootSessionsWithKeeper (OWN-08)', () => {
  it('liga o keeper antes do bootstrap e espera o bootstrap', async () => {
    const calls: string[] = [];
    let finish!: () => void;
    const boot = vi.fn(() => {
      calls.push('boot');
      return new Promise<void>((r) => { finish = r; });
    });
    const done = bootSessionsWithKeeper({ start: () => calls.push('keeper') }, boot);
    expect(calls).toEqual(['keeper', 'boot']);
    let settled = false;
    void done.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    await done;
  });

  it('sem keeper (papel sem o job) só roda o bootstrap', async () => {
    const boot = vi.fn(async () => undefined);
    await bootSessionsWithKeeper(null, boot);
    expect(boot).toHaveBeenCalledTimes(1);
  });

  it('keeper ligado mesmo se o bootstrap falhar', async () => {
    const start = vi.fn();
    await expect(bootSessionsWithKeeper({ start }, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(start).toHaveBeenCalledTimes(1);
  });
});
