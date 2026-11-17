import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithTheme } from '@/test/renderWithTheme';
import type { SaverConfig, SaverGroup } from '../../types';

const svc = vi.hoisted(() => ({ exportContacts: vi.fn() }));
const dl = vi.hoisted(() => ({ downloadBlob: vi.fn() }));
vi.mock('@/services/saver.service', () => ({ saverService: svc }));
vi.mock('./downloadFile', () => dl);

import { ExportDialog, SAVER_EXPORT_OPTIONS_KEY, exportEstimate } from './ExportDialog';
import { saverStrings } from '../../strings';

const t = saverStrings.exportDialog;
const defaults: SaverConfig = { namePrefix: 'Cliente', excludeAdminsByDefault: true, defaultFormat: 'CSV', autoRefresh: false };
const group = (id: string, members: number, phones: number): SaverGroup => ({
  id, groupJid: `${id}@g.us`, name: id, sessionId: 's1', memberCount: members, phoneCount: phones, lidOnlyCount: members - phones,
  lastScannedAt: null, lastScanStatus: null, createdAt: '2026-11-17T10:00:00.000Z',
});
const groups = [group('a', 10, 7), group('b', 5, 5)];

function open(mode: 'light' | 'dark' = 'light', all = false) {
  const onDone = vi.fn();
  const onClose = vi.fn();
  const view = renderWithTheme(<ExportDialog open groups={groups} all={all} defaults={defaults} onClose={onClose} onDone={onDone} />, mode);
  return { onDone, onClose, view };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

describe('exportEstimate', () => {
  it('CSV conta todos ou só com número; vCard deixa fora quem não tem número', () => {
    expect(exportEstimate(groups, { format: 'CSV', onlyWithPhone: false })).toEqual({ included: 15, skipped: 0 });
    expect(exportEstimate(groups, { format: 'CSV', onlyWithPhone: true })).toEqual({ included: 12, skipped: 0 });
    expect(exportEstimate(groups, { format: 'VCARD', onlyWithPhone: false })).toEqual({ included: 12, skipped: 3 });
  });
});

describe('ExportDialog', () => {
  it.each(['light', 'dark'] as const)('vCard mostra quantos ficam fora por não ter número (%s)', async (mode) => {
    const user = userEvent.setup();
    open(mode);
    expect(screen.getByText(t.summaryIncluded(15))).toBeInTheDocument();
    expect(screen.getByDisplayValue('Cliente')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.formats.VCARD }));
    expect(screen.getByText(t.summaryIncluded(12))).toBeInTheDocument();
    expect(screen.getByText(t.summaryVcardSkipped(3))).toBeInTheDocument();
    expect(screen.queryByText(t.onePerGroup)).not.toBeInTheDocument();
  });

  it('baixa por Blob com as opções e limpa o rascunho', async () => {
    const blob = new Blob(['x']);
    svc.exportContacts.mockResolvedValue({ blob, filename: 'contatos-2026-11-17.csv' });
    const user = userEvent.setup();
    const { onDone } = open();
    await user.click(screen.getByRole('checkbox', { name: t.onePerGroup }));
    expect(window.sessionStorage.getItem(`ui.${SAVER_EXPORT_OPTIONS_KEY}`)).not.toBeNull();
    await user.click(screen.getByRole('button', { name: t.download }));
    expect(svc.exportContacts).toHaveBeenCalledWith({
      format: 'CSV', groupIds: ['a', 'b'],
      options: { prefix: 'Cliente', excludeAdmins: true, onlyActive: false, onlyWithPhone: false, onePerGroup: true },
    });
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('contatos-2026-11-17.csv'));
    expect(dl.downloadBlob).toHaveBeenCalledWith(blob, 'contatos-2026-11-17.csv');
    expect(window.sessionStorage.getItem(`ui.${SAVER_EXPORT_OPTIONS_KEY}`)).toBeNull();
  });

  it('todos os grupos manda all', async () => {
    svc.exportContacts.mockResolvedValue({ blob: new Blob(['x']), filename: 'c.vcf' });
    const user = userEvent.setup();
    open('light', true);
    await user.click(screen.getByRole('button', { name: t.download }));
    expect(svc.exportContacts.mock.calls[0]![0].groupIds).toBe('all');
  });

  it('opções persistem ao remontar', async () => {
    const user = userEvent.setup();
    const first = open();
    await user.click(screen.getByRole('checkbox', { name: t.onlyActive }));
    first.view.unmount();
    open();
    expect(screen.getByRole('checkbox', { name: t.onlyActive })).toBeChecked();
  });

  it('403 forçado pede ao administrador e 422 diz que está vazio', async () => {
    svc.exportContacts.mockRejectedValueOnce({ status: 403 }).mockRejectedValueOnce({ status: 422 });
    const user = userEvent.setup();
    const { onDone } = open();
    await user.click(screen.getByRole('button', { name: t.download }));
    expect(await screen.findByText(t.forbidden)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.download }));
    expect(await screen.findByText(t.empty)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(dl.downloadBlob).not.toHaveBeenCalled();
  });
});
