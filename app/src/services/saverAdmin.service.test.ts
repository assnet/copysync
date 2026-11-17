import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('./apiClient', () => ({ apiClient: api }));

import { saverAdminService, toPlatformFilterParams } from './saverAdmin.service';
import { EMPTY_PLATFORM_FILTERS } from '@/features/saverAdmin/types';

beforeEach(() => vi.clearAllMocks());

describe('saverAdminService', () => {
  it('lista com filtros preenchidos e só o cursor; nunca limit/offset', async () => {
    api.get.mockResolvedValue({ data: { data: { items: [], nextCursor: null } } });
    await saverAdminService.listContacts({ ...EMPTY_PLATFORM_FILTERS, search: '  ana ', tenantId: 't1' }, 'cur');
    const params = api.get.mock.calls[0]![1].params as Record<string, string>;
    expect(api.get.mock.calls[0]![0]).toBe('/admin/saver/contacts');
    expect(params).toEqual({ search: 'ana', tenantId: 't1', cursor: 'cur' });
    expect(Object.keys(params)).not.toContain('limit');
    expect(Object.keys(params)).not.toContain('offset');
  });

  it('indicadores: mesmos filtros da lista, sem cursor', async () => {
    const summary = { total: 9, filtered: 4, withPhone: 3, lidOnly: 1, topDdi: [], topDdd: [], ddiBase: 9, dddBase: 0 };
    api.get.mockResolvedValue({ data: { data: summary } });
    await expect(saverAdminService.getSummary({ ...EMPTY_PLATFORM_FILTERS, ddi: '55', ddd: '11' })).resolves.toEqual(summary);
    expect(api.get).toHaveBeenCalledWith('/admin/saver/contacts/summary', { params: { ddi: '55', ddd: '11' } });
  });

  it('período local vira ISO cobrindo o dia todo', () => {
    const p = toPlatformFilterParams({ ...EMPTY_PLATFORM_FILTERS, from: '2026-11-01', to: '2026-11-02' });
    expect(new Date(p.from!).getTime()).toBe(new Date('2026-11-01T00:00:00').getTime());
    expect(new Date(p.to!).getTime()).toBe(new Date('2026-11-02T23:59:59.999').getTime());
    expect(toPlatformFilterParams(EMPTY_PLATFORM_FILTERS)).toEqual({});
  });

  it('exporta em blob com o nome do Content-Disposition', async () => {
    const blob = new Blob(['x']);
    api.post.mockResolvedValue({ data: blob, headers: { 'content-disposition': "attachment; filename*=UTF-8''base%20x.csv" } });
    const file = await saverAdminService.exportContacts(EMPTY_PLATFORM_FILTERS, 'padrao.csv');
    expect(api.post).toHaveBeenCalledWith('/admin/saver/exports', {}, { responseType: 'blob' });
    expect(file).toEqual({ blob, filename: 'base x.csv' });
  });
});
