import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import catalogRaw from '../../../../../contracts/feature-usage/catalog.json?raw';
import { buildNavigation, isNavAction } from '@/features/navigation/model';
import { usagePageViewsService } from '@/services/usagePageViews.service';
import { resetServerClock } from '@/services/serverClock';
import { SCREEN_VIEW_KEYS, screenViewDay, screenViewKeyOf } from '../screenViews';
import { PAGE_VIEW_MARKS_KEY, resetPageViewMarks, usePageViewReporter } from './usePageViewReporter';

/** Processo do Node que roda o teste (o painel não tem os tipos de Node). */
const nodeProcess = (globalThis as unknown as {
  process: { on(e: string, f: (...a: unknown[]) => void): void; off(e: string, f: (...a: unknown[]) => void): void };
}).process;

const TENANT = { isSuperAdmin: false, tenantId: 't-1' };

const flush = () => new Promise((r) => setTimeout(r, 0));
const storedMarks = () => JSON.parse(sessionStorage.getItem(PAGE_VIEW_MARKS_KEY) ?? '{"marks":[]}').marks as string[];

function render(menuKey: string | null, opts = TENANT) {
  return renderHook(({ key, o }) => usePageViewReporter(key, o), { initialProps: { key: menuKey, o: opts } });
}

describe('usePageViewReporter', () => {
  let report: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sessionStorage.clear();
    resetPageViewMarks();
    resetServerClock();
    report = vi.spyOn(usagePageViewsService, 'report').mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('duas visitas à mesma tela na mesma aba = 1 chamada', () => {
    const first = render('offers');
    first.unmount();
    const second = render('offers');
    second.rerender({ key: 'monitoring', o: TENANT });
    second.rerender({ key: 'offers', o: TENANT });
    expect(report).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenNthCalledWith(1, 'view:offers');
    expect(report).toHaveBeenNthCalledWith(2, 'view:monitoring');
  });

  it('outra conta na mesma aba conta à parte', () => {
    const view = render('offers');
    view.rerender({ key: 'offers', o: { isSuperAdmin: false, tenantId: 't-2' } });
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('dia novo descarta as marcas do anterior', async () => {
    sessionStorage.setItem(PAGE_VIEW_MARKS_KEY, JSON.stringify({ day: '2000-01-01', marks: ['t-1|view:offers'] }));
    render('offers');
    expect(report).toHaveBeenCalledTimes(1);
    await flush();
    expect(JSON.parse(sessionStorage.getItem(PAGE_VIEW_MARKS_KEY) ?? '{}').day).not.toBe('2000-01-01');
  });

  it('StrictMode real: duplo efeito gera um único POST', async () => {
    renderHook(() => usePageViewReporter('offers', TENANT), { wrapper: StrictMode });
    expect(report).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(storedMarks()).toEqual(['t-1|view:offers']));
  });

  it('marca só é gravada após o sucesso', async () => {
    let resolve: () => void = () => undefined;
    report.mockReturnValue(new Promise<void>((r) => { resolve = r; }));
    render('offers');
    expect(storedMarks()).toEqual([]);
    resolve();
    await waitFor(() => expect(storedMarks()).toEqual(['t-1|view:offers']));
  });

  it.each([
    ['429', Object.assign(new Error('Too Many Requests'), { status: 429 })],
    ['timeout', Object.assign(new Error('timeout'), { code: 'ECONNABORTED' })],
    ['rede', new Error('Network Error')],
  ])('falha (%s) não grava marca, não escapa e a próxima visita reenvia', async (_n, error) => {
    const unhandled = vi.fn();
    nodeProcess.on('unhandledRejection', unhandled);
    try {
      report.mockRejectedValueOnce(error);
      const first = render('offers');
      await flush();
      first.unmount();
      expect(storedMarks()).toEqual([]);
      render('offers');
      expect(report).toHaveBeenCalledTimes(2);
      await flush();
      expect(storedMarks()).toEqual(['t-1|view:offers']);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      nodeProcess.off('unhandledRejection', unhandled);
    }
  });

  it('rota fora do menu, sem conta ou super admin não envia', () => {
    render(null);
    render('admin-usage');
    render('chat');
    render('offers', { isSuperAdmin: false, tenantId: null as unknown as string });
    render('offers', { isSuperAdmin: true, tenantId: 't-1' });
    expect(report).not.toHaveBeenCalled();
  });

  it('sessionStorage indisponível não quebra e ainda evita repetir na aba', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const view = render('offers');
    view.rerender({ key: 'dashboard', o: TENANT });
    view.rerender({ key: 'offers', o: TENANT });
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('marca corrompida no storage é ignorada', () => {
    sessionStorage.setItem(PAGE_VIEW_MARKS_KEY, '{nao-json');
    render('offers');
    expect(report).toHaveBeenCalledTimes(1);
  });
});

describe('telas medidas por visita', () => {
  it('espelha screenKeys do contrato', () => {
    const catalog = JSON.parse(catalogRaw) as { screenKeys: string[] };
    expect([...SCREEN_VIEW_KEYS].sort()).toEqual([...catalog.screenKeys].sort());
  });

  it('toda chave do menu da conta tem view:* correspondente', () => {
    const model = buildNavigation({ isSuperAdmin: false, offerHunterVisible: true, saverVisible: true, products: ['AFFILIATES', 'CHAT', 'SAVER'] });
    const keys = [
      ...model.top,
      ...model.products.flatMap((p) => p.children),
      ...model.platform,
      ...model.bottom.filter((e) => !isNavAction(e)),
    ].map((l) => l.key);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(screenViewKeyOf(key), key).not.toBeNull();
    expect(keys.map((k) => `view:${k}`).sort()).toEqual([...SCREEN_VIEW_KEYS].sort());
  });

  it('dia no fuso de Brasília', () => {
    expect(screenViewDay(Date.UTC(2026, 10, 17, 2, 30))).toBe('2026-11-16');
    expect(screenViewDay(Date.UTC(2026, 10, 17, 3, 30))).toBe('2026-11-17');
  });
});
