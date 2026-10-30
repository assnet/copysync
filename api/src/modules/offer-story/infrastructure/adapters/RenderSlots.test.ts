import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OFFER_STORY_FONTS_DIR } from './offerStoryFonts';
import { RenderSlots } from './SatoriOfferStoryRenderer';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('RenderSlots', () => {
  it('nunca passa do limite, nem quando chamada nova chega no meio do repasse da vaga', async () => {
    const slots = new RenderSlots(2, 10);
    let running = 0;
    let peak = 0;
    const gates = Array.from({ length: 5 }, deferred);
    const task = (i: number) => async () => {
      running += 1;
      peak = Math.max(peak, running);
      await gates[i].promise;
      running -= 1;
    };
    const all = [0, 1, 2].map((i) => slots.run(task(i)));
    gates[0].resolve();
    // chamada nova no mesmo tick da liberação
    all.push(slots.run(task(3)), slots.run(task(4)));
    for (const g of gates) g.resolve();
    await Promise.all(all);
    expect(peak).toBe(2);
  });

  it('fila cheia → MEDIA_PROCESSOR_UNAVAILABLE e a vaga continua utilizável', async () => {
    const slots = new RenderSlots(1, 1);
    const gate = deferred();
    const first = slots.run(() => gate.promise);
    const queued = slots.run(async () => 'ok');
    await expect(slots.run(async () => 'x')).rejects.toMatchObject({ code: 'MEDIA_PROCESSOR_UNAVAILABLE', statusCode: 503 });
    gate.resolve();
    await first;
    await expect(queued).resolves.toBe('ok');
    await expect(slots.run(async () => 'depois')).resolves.toBe('depois');
  });

  it('erro na tarefa libera a vaga', async () => {
    const slots = new RenderSlots(1, 0);
    await expect(slots.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(slots.run(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('OFFER_STORY_FONTS_DIR', () => {
  it('aponta para api/assets/offer-story/fonts', () => {
    expect(OFFER_STORY_FONTS_DIR.endsWith(path.join('api', 'assets', 'offer-story', 'fonts'))).toBe(true);
    expect(existsSync(path.join(OFFER_STORY_FONTS_DIR, 'inter-latin-700-normal.woff'))).toBe(true);
  });
});
