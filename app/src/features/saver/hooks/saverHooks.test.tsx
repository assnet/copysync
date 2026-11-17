import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { SaverExtraction, SaverGroup } from '../types';

const svc = vi.hoisted(() => ({
  getOverview: vi.fn(), listGroups: vi.fn(), removeGroup: vi.fn(), listSessionGroups: vi.fn(),
  getExtraction: vi.fn(), cancelExtraction: vi.fn(), getConfig: vi.fn(), updateConfig: vi.fn(),
}));
vi.mock('@/services/saver.service', () => ({ saverService: svc }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 't1' }) }));

import { SAVER_EXTRACTION_POLL_MS, useSaverConfig, useSaverExtraction, useSaverGroups, useSaverOverview, useSaverSessionGroups } from '.';

const extraction = (status: SaverExtraction['status'], over: Partial<SaverExtraction> = {}): SaverExtraction => ({
  id: 'e1', sessionId: 's1', trigger: 'MANUAL', status, totalGroups: 2, doneGroups: 0, failedGroups: 0,
  membersFound: 0, newContacts: 0, createdAt: '2026-11-17T10:00:00.000Z', finishedAt: null, ...over,
});
const group = (id: string): SaverGroup => ({
  id, groupJid: `${id}@g.us`, name: `Grupo ${id}`, sessionId: 's1', memberCount: 3, phoneCount: 2, lidOnlyCount: 1,
  lastScannedAt: null, lastScanStatus: null, createdAt: '2026-11-17T10:00:00.000Z',
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe('useSaverOverview', () => {
  it('carrega e traduz erro de produto', async () => {
    svc.getOverview.mockRejectedValue({ code: 'PRODUCT_UNAVAILABLE', status: 403 });
    const { result } = renderHook(() => useSaverOverview());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.kind).toBe('productUnavailable');
    expect(result.current.data).toBeNull();
  });
});

describe('useSaverSessionGroups', () => {
  it('sem sessão não consulta', async () => {
    const { result } = renderHook(() => useSaverSessionGroups(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(svc.listSessionGroups).not.toHaveBeenCalled();
  });

  it('sessão desconectada vira sessionNotConnected', async () => {
    svc.listSessionGroups.mockRejectedValue({ code: 'SESSION_NOT_CONNECTED', status: 409 });
    const { result } = renderHook(() => useSaverSessionGroups('s1'));
    await waitFor(() => expect(result.current.error?.kind).toBe('sessionNotConnected'));
  });
});

describe('useSaverGroups', () => {
  it('remover é otimista e volta a lista em falha', async () => {
    svc.listGroups.mockResolvedValue([group('a'), group('b')]);
    svc.removeGroup.mockRejectedValue({ code: 'FORBIDDEN', status: 403 });
    const { result } = renderHook(() => useSaverGroups());
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    let ok = true;
    await act(async () => { ok = await result.current.remove('a'); });
    expect(ok).toBe(false);
    expect(result.current.data?.map((g) => g.id)).toEqual(['a', 'b']);
    expect(result.current.actionError?.kind).toBe('forbidden');
  });
});

describe('useSaverExtraction', () => {
  it('consulta a cada 3 s enquanto ativa e para ao terminar', async () => {
    vi.useFakeTimers();
    svc.getExtraction
      .mockResolvedValueOnce(extraction('RUNNING', { doneGroups: 1 }))
      .mockResolvedValueOnce(extraction('DONE', { doneGroups: 2 }));
    const { result } = renderHook(() => useSaverExtraction('e1', extraction('QUEUED')));
    expect(result.current.active).toBe(true);
    expect(svc.getExtraction).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(SAVER_EXTRACTION_POLL_MS); });
    expect(result.current.extraction?.doneGroups).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(SAVER_EXTRACTION_POLL_MS); });
    expect(result.current.extraction?.status).toBe('DONE');
    expect(result.current.active).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(SAVER_EXTRACTION_POLL_MS * 3); });
    expect(svc.getExtraction).toHaveBeenCalledTimes(2);
  });

  it('para de consultar ao desmontar', async () => {
    vi.useFakeTimers();
    svc.getExtraction.mockResolvedValue(extraction('RUNNING'));
    const { unmount } = renderHook(() => useSaverExtraction('e1', extraction('RUNNING')));
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(SAVER_EXTRACTION_POLL_MS * 2); });
    expect(svc.getExtraction).not.toHaveBeenCalled();
  });
});

describe('useSaverConfig', () => {
  it('salvar troca o dado; falha guarda o erro', async () => {
    const cfg = { namePrefix: null, excludeAdminsByDefault: false, defaultFormat: 'CSV' as const, autoRefresh: false };
    svc.getConfig.mockResolvedValue(cfg);
    svc.updateConfig.mockResolvedValueOnce({ ...cfg, namePrefix: 'Cliente' }).mockRejectedValueOnce({ code: 'FORBIDDEN', status: 403 });
    const { result } = renderHook(() => useSaverConfig());
    await waitFor(() => expect(result.current.data).toEqual(cfg));
    await act(async () => { await result.current.save({ namePrefix: 'Cliente' }); });
    expect(result.current.data?.namePrefix).toBe('Cliente');
    let ok = true;
    await act(async () => { ok = await result.current.save({ autoRefresh: true }); });
    expect(ok).toBe(false);
    expect(result.current.saveError?.kind).toBe('forbidden');
  });
});
