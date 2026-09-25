import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computeWaveform,
  loadWaveform,
  pseudoWaveform,
  reduceSamples,
  resetWaveformCache,
} from './audioWaveform';

afterEach(() => {
  resetWaveformCache();
  vi.unstubAllGlobals();
});

describe('reduceSamples — média absoluta por bloco', () => {
  it('devolve exatamente o número de barras pedido, normalizado pelo pico', () => {
    const samples = [0.1, -0.1, 0.5, -0.5, 1, -1, 0.2, -0.2];
    const bars = reduceSamples(samples, 4);
    expect(bars).toHaveLength(4);
    expect(bars).toEqual([0.1, 0.5, 1, 0.2]);
    expect(Math.max(...bars)).toBe(1);
  });

  it('silêncio total vira barras zeradas em vez de dividir por zero', () => {
    expect(reduceSamples(new Float32Array(16), 4)).toEqual([0, 0, 0, 0]);
    expect(reduceSamples([], 3)).toEqual([0, 0, 0]);
  });

  it('amostras a menos que barras não geram NaN', () => {
    const bars = reduceSamples([0.5, 1], 6);
    expect(bars).toHaveLength(6);
    expect(bars.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
  });
});

describe('pseudoWaveform — onda provisória determinística', () => {
  it('mesma semente gera a mesma onda; semente diferente gera outra', () => {
    const a = pseudoWaveform('msg-1', 44);
    const b = pseudoWaveform('msg-1', 44);
    const c = pseudoWaveform('msg-2', 44);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('tem o tamanho pedido e barras entre 0.25 e 1 para nenhuma sumir', () => {
    const bars = pseudoWaveform('https://cdn/x.ogg', 40);
    expect(bars).toHaveLength(40);
    expect(bars.every((value) => value >= 0.25 && value <= 1)).toBe(true);
  });
});

describe('computeWaveform — decodificação', () => {
  it('rejeita sem AudioContext (Safari com Ogg, ambiente de teste)', async () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);
    await expect(computeWaveform(new ArrayBuffer(8), 4)).rejects.toThrow();
  });

  it('usa o canal 0 do buffer decodificado e fecha o contexto', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const channel = new Float32Array([0.2, 0.2, 0.8, 0.8]);
    class FakeContext {
      close = close;
      decodeAudioData(_buf: ArrayBuffer) {
        return Promise.resolve({ getChannelData: () => channel });
      }
    }
    vi.stubGlobal('AudioContext', FakeContext);
    await expect(computeWaveform(new ArrayBuffer(8), 2)).resolves.toEqual([0.25, 1]);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('loadWaveform — cache por URL', () => {
  it('baixa uma vez e reaproveita nas próximas chamadas', async () => {
    const channel = new Float32Array([1, 1, 0.5, 0.5]);
    class FakeContext {
      close = vi.fn().mockResolvedValue(undefined);
      decodeAudioData() {
        return Promise.resolve({ getChannelData: () => channel });
      }
    }
    vi.stubGlobal('AudioContext', FakeContext);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    vi.stubGlobal('fetch', fetchMock);

    const first = await loadWaveform('https://cdn/a.ogg', 2);
    const second = await loadWaveform('https://cdn/a.ogg', 2);
    expect(first).toEqual([1, 0.5]);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resposta HTTP de erro rejeita e não entra no cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadWaveform('https://cdn/b.ogg', 2)).rejects.toThrow('HTTP 404');
    await expect(loadWaveform('https://cdn/b.ogg', 2)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
