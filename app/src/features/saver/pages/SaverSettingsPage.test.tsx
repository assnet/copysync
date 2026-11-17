import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithTheme } from '@/test/renderWithTheme';
import type { SaverConfigDetails, SaverExportGrant, SaverOverview } from '../types';

const svc = vi.hoisted(() => ({
  getOverview: vi.fn(), getConfig: vi.fn(), updateConfig: vi.fn(), listExportGrants: vi.fn(), setExportGrant: vi.fn(),
}));
const blur = vi.hoisted(() => ({ flags: new Set<string>() }));
vi.mock('@/services/saver.service', () => ({ saverService: svc }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 't1' }) }));
vi.mock('@/features/privacy/PrivacyContext', () => ({ useBlur: (f: string) => blur.flags.has(f) }));

import { SaverSettingsPage, saverConfigChanges } from './SaverSettingsPage';
import { saverStrings as s } from '../strings';

const baseConfig = { namePrefix: null, excludeAdminsByDefault: false, defaultFormat: 'CSV' as const, autoRefresh: false };
const overview = (configure: boolean, autoRefreshEnabled = true): SaverOverview => ({
  groups: { used: 0, limit: 5, remaining: 5 },
  contacts: { used: 0, limit: 100, remaining: 100 },
  groupScansPerDay: { used: 0, limit: 10, remaining: 10 },
  autoRefreshEnabled,
  permissions: { view: true, extract: true, export: configure, configure },
  config: { ...baseConfig, namePrefix: 'Lead' },
  queueRunning: true,
  pilot: false,
});
const details = (over: Partial<SaverConfigDetails> = {}): SaverConfigDetails => ({
  ...baseConfig, autoRefreshAvailable: true, configured: false, updatedAt: null, ...over,
});
const grant = (userId: string, name: string, canExport = false): SaverExportGrant => ({ userId, name, email: `${userId}@x.com`, canExport });

const page = (mode: 'light' | 'dark' = 'light') => renderWithTheme(<SaverSettingsPage />, mode);
const prefixInput = () => screen.findByLabelText(s.settings.prefix.label) as Promise<HTMLInputElement>;
const saveButton = () => screen.queryByRole('button', { name: s.settings.save });

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  blur.flags = new Set();
});

describe('SaverSettingsPage', () => {
  it.each(['light', 'dark'] as const)('OPERATOR vê tudo desabilitado, sem salvar e sem liberação (%s)', async (mode) => {
    svc.getOverview.mockResolvedValue(overview(false));
    page(mode);
    expect(await prefixInput()).toBeDisabled();
    expect((await prefixInput()).value).toBe('Lead');
    expect(screen.getByText(s.settings.readOnly)).toBeInTheDocument();
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
    for (const b of screen.getAllByRole('button', { name: /CSV|vCard/ })) expect(b).toBeDisabled();
    expect(saveButton()).toBeNull();
    expect(screen.queryByText(s.grants.title)).toBeNull();
    expect(svc.getConfig).not.toHaveBeenCalled();
    expect(svc.listExportGrants).not.toHaveBeenCalled();
  });

  it('atualização diária desabilitada com dica quando o plano não inclui', async () => {
    svc.getOverview.mockResolvedValue(overview(true, false));
    svc.getConfig.mockResolvedValue(details({ autoRefreshAvailable: false }));
    svc.listExportGrants.mockResolvedValue([]);
    page('dark');
    const toggle = await screen.findByRole('checkbox', { name: s.settings.autoRefresh.title });
    expect(toggle).toBeDisabled();
    expect(toggle).not.toBeChecked();
    expect(screen.getByText(s.settings.autoRefresh.unavailableShort)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: s.settings.excludeAdmins.title })).toBeEnabled();
  });

  it('liga/desliga é o Switch do tema', async () => {
    svc.getOverview.mockResolvedValue(overview(true));
    svc.getConfig.mockResolvedValue(details());
    svc.listExportGrants.mockResolvedValue([grant('u1', 'Ana')]);
    page();
    const toggles = [
      await screen.findByRole('checkbox', { name: s.settings.excludeAdmins.title }),
      screen.getByRole('checkbox', { name: s.settings.autoRefresh.title }),
      await screen.findByRole('checkbox', { name: s.grants.switchLabel('Ana') }),
    ];
    for (const el of toggles) expect(el.closest('.MuiSwitch-root')).not.toBeNull();
  });

  it('rascunho persiste após remontar e limpa ao salvar', async () => {
    const user = userEvent.setup();
    svc.getOverview.mockResolvedValue(overview(true));
    svc.getConfig.mockResolvedValue(details());
    svc.listExportGrants.mockResolvedValue([]);
    const first = page();
    expect(saveButton()).toBeNull();
    await user.type(await prefixInput(), 'Cliente');
    await user.click(screen.getByRole('checkbox', { name: s.settings.excludeAdmins.title }));
    await user.click(screen.getByRole('button', { name: s.settings.format.VCARD }));
    first.unmount();

    page();
    expect((await prefixInput()).value).toBe('Cliente');
    expect(screen.getByRole('checkbox', { name: s.settings.excludeAdmins.title })).toBeChecked();
    expect(screen.getByText(s.settings.unsaved)).toBeInTheDocument();

    svc.updateConfig.mockResolvedValue(details({ namePrefix: 'Cliente', excludeAdminsByDefault: true, defaultFormat: 'VCARD', configured: true, updatedAt: '2026-11-17T12:00:00.000Z' }));
    await user.click(saveButton()!);
    expect(svc.updateConfig).toHaveBeenCalledWith({ namePrefix: 'Cliente', excludeAdminsByDefault: true, defaultFormat: 'VCARD' });
    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(window.sessionStorage.getItem('ui.saver.settings.draft.t1')).toBeNull();
    expect(await screen.findByText(s.settings.saved)).toBeInTheDocument();
  });

  it('falha ao salvar mantém o rascunho', async () => {
    const user = userEvent.setup();
    svc.getOverview.mockResolvedValue(overview(true));
    svc.getConfig.mockResolvedValue(details());
    svc.listExportGrants.mockResolvedValue([]);
    svc.updateConfig.mockRejectedValue({ code: 'FORBIDDEN', status: 403 });
    page();
    await user.type(await prefixInput(), 'X');
    await user.click(saveButton()!);
    expect(await screen.findByText(s.errors.FORBIDDEN!)).toBeInTheDocument();
    expect(window.sessionStorage.getItem('ui.saver.settings.draft.t1')).not.toBeNull();
  });

  it('sem operador mostra o texto de orientação', async () => {
    svc.getOverview.mockResolvedValue(overview(true));
    svc.getConfig.mockResolvedValue(details());
    svc.listExportGrants.mockResolvedValue([]);
    page();
    expect(await screen.findByText(s.grants.empty)).toBeInTheDocument();
    expect(screen.getByText(s.grants.emptyHint)).toBeInTheDocument();
  });

  it('falha ao liberar desfaz o Switch', async () => {
    const user = userEvent.setup();
    svc.getOverview.mockResolvedValue(overview(true));
    svc.getConfig.mockResolvedValue(details());
    svc.listExportGrants.mockResolvedValue([grant('u1', 'Ana')]);
    let reject!: (e: unknown) => void;
    svc.setExportGrant.mockReturnValue(new Promise((_r, rej) => { reject = rej; }));
    page();
    const sw = await screen.findByRole('checkbox', { name: s.grants.switchLabel('Ana') });
    await user.click(sw);
    expect(sw).toBeChecked();
    expect(svc.setExportGrant).toHaveBeenCalledWith('u1', true);
    reject({ code: 'VALIDATION_ERROR', status: 400 });
    await waitFor(() => expect(sw).not.toBeChecked());
    expect(screen.getByText(s.grants.toggleFailed)).toBeInTheDocument();
  });

  it('nome do operador borrado com saver.teamNames', async () => {
    blur.flags = new Set(['saver.teamNames']);
    svc.getOverview.mockResolvedValue(overview(true));
    svc.getConfig.mockResolvedValue(details());
    svc.listExportGrants.mockResolvedValue([grant('u1', 'Ana')]);
    page('dark');
    const name = await screen.findByText('Ana');
    const blurred = name.closest('[data-blurred="true"]');
    expect(blurred).not.toBeNull();
    expect(within(blurred as HTMLElement).getByText('u1@x.com')).toBeInTheDocument();
  });
});

describe('saverConfigChanges', () => {
  it('manda só o que mudou e prefixo vazio vira null', () => {
    const saved = { ...baseConfig, namePrefix: 'A' };
    expect(saverConfigChanges(saved, { namePrefix: '  ', defaultFormat: 'CSV' })).toEqual({ namePrefix: null });
    expect(saverConfigChanges(saved, { namePrefix: ' A ' })).toEqual({});
  });
});
