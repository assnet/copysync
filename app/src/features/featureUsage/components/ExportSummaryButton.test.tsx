import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { downloadBlob } from '@/features/saver/components/export/downloadFile';
import { AdminUsagePage } from '@/pages/admin/AdminUsagePage';
import { adminUsageService } from '@/services/adminUsage.service';
import { USAGE_FEATURE_ROUTE, USAGE_PATH, usageFeaturePath } from '../paths';
import { featureUsageStrings as S } from '../strings';
import { summaryToCsv } from '../rules';
import { detailFixture, summaryFixture } from '../testFixtures';
import { ExportSummaryButton } from './ExportSummaryButton';

vi.mock('@/features/saver/components/export/downloadFile', () => ({ downloadBlob: vi.fn() }));
vi.mock('@/services/adminUsage.service', () => ({
  adminUsageService: { getSummary: vi.fn(), getDetail: vi.fn(), getTenants: vi.fn() },
}));

const download = vi.mocked(downloadBlob);

beforeEach(() => {
  download.mockReset();
  window.sessionStorage.clear();
  vi.mocked(adminUsageService.getSummary).mockResolvedValue(summaryFixture());
  vi.mocked(adminUsageService.getDetail).mockResolvedValue(detailFixture());
});

describe('ExportSummaryButton', () => {
  it.each(['light', 'dark'] as const)('baixa o CSV do resumo carregado na ordenação ativa (%s)', async (mode) => {
    const summary = summaryFixture();
    renderWithTheme(<ExportSummaryButton summary={summary} loading={false} sort="uses" />, mode);
    await userEvent.click(screen.getByRole('button', { name: S.csv.button }));

    expect(download).toHaveBeenCalledTimes(1);
    const [blob, name] = download.mock.calls[0];
    expect(name).toBe(`uso-dos-recursos_${summary.range.from}_${summary.range.to}.csv`);
    // `text()` descarta o BOM: decodifica os bytes crus para conferir o arquivo inteiro.
    const bytes = await (blob as Blob).arrayBuffer();
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)).toBe(summaryToCsv(summary, 'uses'));
    expect(adminUsageService.getSummary).not.toHaveBeenCalled();
  });

  it('fica desabilitado durante a carga, sem resposta e sem recursos', () => {
    const empty = { ...summaryFixture(), features: [] };
    const { rerender } = renderWithTheme(<ExportSummaryButton summary={summaryFixture()} loading sort="tenants" />);
    expect(screen.getByRole('button', { name: S.csv.button })).toBeDisabled();
    rerender(<ExportSummaryButton summary={null} loading={false} sort="tenants" />);
    expect(screen.getByRole('button', { name: S.csv.button })).toBeDisabled();
    rerender(<ExportSummaryButton summary={empty} loading={false} sort="tenants" />);
    expect(screen.getByRole('button', { name: S.csv.button })).toBeDisabled();
  });

  it('aparece no cabeçalho da visão geral e some no detalhe do recurso', async () => {
    const page = (path: string) => (
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={USAGE_PATH} element={<AdminUsagePage />} />
          <Route path={USAGE_FEATURE_ROUTE} element={<AdminUsagePage />} />
        </Routes>
      </MemoryRouter>
    );
    const { unmount } = renderWithTheme(page(USAGE_PATH));
    expect(await screen.findByRole('button', { name: S.csv.button })).toBeEnabled();
    unmount();

    renderWithTheme(page(usageFeaturePath(summaryFixture().features[0].key)));
    expect(await screen.findByLabelText(S.actions.refreshAria)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: S.csv.button })).not.toBeInTheDocument();
  });
});
