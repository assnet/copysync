import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithTheme } from '@/test/renderWithTheme';
import { AdminPlanEntitlementsPage } from '@/pages/admin/AdminPlanEntitlementsPage';
import { adminPlanEntitlementsService } from '@/services/adminPlanEntitlements.service';
import { planEntitlementsAdminStrings as t } from './strings';

afterEach(() => vi.restoreAllMocks());

const KEY = 'marketplace_shein_enabled';
const list = () => ({
  plans: ['COPYSYNC_LITE', 'COPYSYNC_PRO', 'COPYSYNC_MAX'],
  entitlements: [{ key: KEY, plans: { COPYSYNC_LITE: false, COPYSYNC_PRO: null, COPYSYNC_MAX: true } }],
});

describe('AdminPlanEntitlementsPage', () => {
  it('mostra a tabela chave × plano com rótulo legível e estado dos switches (escuro)', async () => {
    vi.spyOn(adminPlanEntitlementsService, 'list').mockResolvedValue(list());
    renderWithTheme(<AdminPlanEntitlementsPage />, 'dark');
    expect(await screen.findByText('Afiliado Shein')).toBeInTheDocument();
    expect(screen.getByText(t.features[KEY].description)).toBeInTheDocument();
    for (const p of ['LITE', 'PRO', 'MAX']) expect(screen.getByRole('columnheader', { name: p })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: t.switchAria('Afiliado Shein', 'MAX') })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: t.switchAria('Afiliado Shein', 'PRO') })).not.toBeChecked();
    expect(screen.getByLabelText(t.notPresetHint)).toBeInTheDocument();
  });

  it('troca pede confirmação, chama PUT e mostra clientes atualizados', async () => {
    vi.spyOn(adminPlanEntitlementsService, 'list').mockResolvedValue(list());
    const set = vi.spyOn(adminPlanEntitlementsService, 'set').mockResolvedValue({
      planSlug: 'COPYSYNC_PRO', key: KEY, value: true, tenantsUpdated: 12,
    });
    const user = userEvent.setup();
    renderWithTheme(<AdminPlanEntitlementsPage />);
    const sw = await screen.findByRole('checkbox', { name: t.switchAria('Afiliado Shein', 'PRO') });
    await user.click(sw);
    expect(set).not.toHaveBeenCalled();
    expect(screen.getByText(t.confirm.titleOn('Afiliado Shein', 'PRO'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.confirm.confirmOn }));
    expect(set).toHaveBeenCalledWith('COPYSYNC_PRO', KEY, true);
    expect(await screen.findByText(t.saved('Afiliado Shein', 'PRO', true, 12))).toBeInTheDocument();
    expect(await screen.findByRole('checkbox', { name: t.switchAria('Afiliado Shein', 'PRO') })).toBeChecked();
  });

  it('cancelar não chama PUT', async () => {
    vi.spyOn(adminPlanEntitlementsService, 'list').mockResolvedValue(list());
    const set = vi.spyOn(adminPlanEntitlementsService, 'set');
    const user = userEvent.setup();
    renderWithTheme(<AdminPlanEntitlementsPage />);
    await user.click(await screen.findByRole('checkbox', { name: t.switchAria('Afiliado Shein', 'MAX') }));
    await user.click(screen.getByRole('button', { name: t.confirm.cancel }));
    expect(set).not.toHaveBeenCalled();
    expect(await screen.findByRole('checkbox', { name: t.switchAria('Afiliado Shein', 'MAX') })).toBeChecked();
  });

  it('erro no PUT mostra mensagem e mantém o valor', async () => {
    vi.spyOn(adminPlanEntitlementsService, 'list').mockResolvedValue(list());
    vi.spyOn(adminPlanEntitlementsService, 'set').mockRejectedValue(Object.assign(new Error('x'), { code: 'VALIDATION_ERROR' }));
    const user = userEvent.setup();
    renderWithTheme(<AdminPlanEntitlementsPage />);
    await user.click(await screen.findByRole('checkbox', { name: t.switchAria('Afiliado Shein', 'MAX') }));
    await user.click(screen.getByRole('button', { name: t.confirm.confirmOff }));
    expect(await screen.findByText(t.errors.VALIDATION_ERROR)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('checkbox', { name: t.switchAria('Afiliado Shein', 'MAX') })).toBeChecked());
  });

  it('falha ao carregar mostra erro com tentar de novo', async () => {
    vi.spyOn(adminPlanEntitlementsService, 'list').mockRejectedValue(new Error('x'));
    renderWithTheme(<AdminPlanEntitlementsPage />);
    expect(await screen.findByText(t.errors.load)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.retry })).toBeInTheDocument();
  });
});
