import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { MediaUploadConfigDto } from '@/types/media.api.types';
import { mediaService } from '@/services/media.service';
import { configRetryDelay, useMediaUploadConfig } from './useMediaUploadConfig';

vi.mock('@/services/media.service', () => ({ mediaService: { getUploadConfig: vi.fn() } }));

const getUploadConfig = vi.mocked(mediaService.getUploadConfig);

const config: MediaUploadConfigDto = {
  chunkSizeBytes: 8_388_608,
  maxFilesPerBatch: 30,
  maxVoiceSeconds: 900,
  maxCaptionLength: 4096,
  limits: { imageBytes: 16_000_000, inlineVideoBytes: 180_000_000, documentBytes: 180_000_000, voiceBytes: 16_000_000 },
  capabilities: { voiceNotes: true, videoMetadata: true },
};

const falhaDeRede = () => Promise.reject(new Error('Network Error'));

describe('configRetryDelay — espera entre tentativas', () => {
  it('cresce de 1 s até o teto de 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map(configRetryDelay)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
    ]);
  });
});

describe('useMediaUploadConfig — configuração de anexos e voz', () => {
  beforeEach(() => {
    getUploadConfig.mockReset();
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('carrega a configuração', async () => {
    getUploadConfig.mockResolvedValueOnce(config);
    const { result } = renderHook(() => useMediaUploadConfig());
    expect(result.current.status).toBe('loading');

    await act(async () => undefined);
    expect(result.current).toEqual({ config, status: 'ready' });
  });

  it('falha uma vez e tenta de novo sozinha, sem desligar anexos para sempre', async () => {
    getUploadConfig.mockImplementationOnce(falhaDeRede).mockImplementationOnce(falhaDeRede).mockResolvedValueOnce(config);
    const { result } = renderHook(() => useMediaUploadConfig());

    await act(async () => undefined);
    expect(result.current.status).toBe('error');

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(getUploadConfig).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('error');

    // Segunda espera é maior: 2 s.
    await act(async () => vi.advanceTimersByTimeAsync(1_999));
    expect(getUploadConfig).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(getUploadConfig).toHaveBeenCalledTimes(3);
    expect(result.current).toEqual({ config, status: 'ready' });
  });

  it('em erro, focar a janela tenta na hora', async () => {
    getUploadConfig.mockImplementationOnce(falhaDeRede).mockResolvedValueOnce(config);
    const { result } = renderHook(() => useMediaUploadConfig());
    await act(async () => undefined);
    expect(result.current.status).toBe('error');

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(getUploadConfig).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('ready');

    // A espera agendada antes do foco não gera chamada extra.
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(getUploadConfig).toHaveBeenCalledTimes(2);
  });

  it('carregada, focar a janela não busca de novo', async () => {
    getUploadConfig.mockResolvedValueOnce(config);
    renderHook(() => useMediaUploadConfig());
    await act(async () => undefined);

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(getUploadConfig).toHaveBeenCalledTimes(1);
  });

  it('desmontada, para de tentar', async () => {
    getUploadConfig.mockImplementation(falhaDeRede);
    const { unmount } = renderHook(() => useMediaUploadConfig());
    await act(async () => undefined);
    unmount();

    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    window.dispatchEvent(new Event('focus'));
    expect(getUploadConfig).toHaveBeenCalledTimes(1);
  });
});
