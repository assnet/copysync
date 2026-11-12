import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithTheme } from '@/test/renderWithTheme';
import { AdminPlanEntitlementsPage } from '@/pages/admin/AdminPlanEntitlementsPage';
import { adminPlanEntitlementsService } from '@/services/adminPlanEntitlements.service';
import { planEntitlementsAdminStrings as t } from './strings';
import type { AdminPlanEntitlementList } from './types';

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

const KEY = 'marketplace_shein_enabled';
const NUM = 'offer_hunter_finds_per_day';
const NUM_LABEL = 'Achados por dia do Caçador';
const list = (): AdminPlanEntitlementList => ({
  plans: ['COPYSYNC_LITE', 'COPYSYNC_PRO', 'COPYSYNC_MAX'],
  entitlements: [
    { key: KEY, type: { kind: 'boolean' }, plans: { COPYSYNC_LITE: false, COPYSYNC_PRO: null, COPYSYNC_MAX: true } },
    { key: NUM, type: { kind: 'integer', min: 0, max: 100 }, plans: { COPYSYNC_LITE: 0, COPYSYNC_PRO: null, COPYSYNC_MAX: 10 } },
  ],
});
const numInput = (plan: string) => screen.findByRole('textbox', { name: t.number.aria(NUM_LABEL, plan) });
const saveBtn = (plan: string) => screen.getByRole('button', { name: t.number.save(NUM_LABEL, plan) });

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

  it('chave numérica: campo com o valor, sem Switch; ausente mostra dica de 0', async () => {
    vi.spyOn(adminPlanEntitlementsService, 'list').mockResolvedValue(list());
    renderWithTheme(<AdminPlanEntitlementsPage />, 'dark');
    expect(await numInput('MAX')).toHaveValue('10');
    expect(await numInput('PRO')).toHaveValue('');
    expect(screen.queryByRole('checkbox', { name: t.switchAria(NUM_LABEL, 'MAX') })).not.toBeInTheDocument();
    expect(screen.getByLabelText(t.notPresetHintNumber)).toBeInTheDocument();
    expect(saveBtn('MAX')).toBeDisabled();
  });

  it('chave numérica: digitar não grava; salvar pede confirmação "de X para Y" e grava o inteiro', async () => {
    vi.spyOn(adminPlanEntitlementsService, 'list').mockResolvedValue(list());
    const set = vi.spyOn(adminPlanEntitlementsService, 'set').mockResolvedValue({
      planSlug: 'COPYSYNC_MAX', key: NUM, value: 25, tenantsUpdated: 3,
    });
    const user = userEvent.setup();
    renderWithTheme(<AdminPlanEntitlementsPage />);
    const input = await numInput('MAX');
    await user.clear(input);
    await user.type(input, '25');
    expect(set).not.toHaveBeenCalled();
    await user.click(saveBtn('MAX'));
    expect(set).not.toHaveBeenCalled();
    expect(screen.getByText(t.confirm.titleNumber(NUM_LABEL, 'MAX'))).toBeInTheDocument();
    expect(screen.getByText(t.confirm.descriptionNumber(10, 25, 'MAX'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.confirm.confirmNumber }));
    expect(set).toHaveBeenCalledWith('COPYSYNC_MAX', NUM, 25);
    expect(await screen.findByText(t.savedNumber(NUM_LABEL, 'MAX', 25, 3))).toBeInTheDocument();
    expect(await numInput('MAX')).toHaveValue('25');
  });

  it('chave numérica: fora da faixa ou não inteiro mostra erro e não deixa salvar', async () => {
    vi.spyOn(adminPlanEntitlementsService, 'list').mockResolvedValue(list());
    const set = vi.spyOn(adminPlanEntitlementsService, 'set');
    const user = userEvent.setup();
    renderWithTheme(<AdminPlanEntitlementsPage />);
    const input = await numInput('MAX');
    for (const bad of ['101', '2.5', '-1', 'abc']) {
      await user.clear(input);
      await user.type(input, bad);
      expect(screen.getByText(t.number.invalid(0, 100))).toBeInTheDocument();
      expect(saveBtn('MAX')).toBeDisabled();
      await user.type(input, '{Enter}');
    }
    expect(set).not.toHaveBeenCalled();
    expect(screen.queryByText(t.confirm.titleNumber(NUM_LABEL, 'MAX'))).not.toBeInTheDocument();
  });

  it('falha ao carregar mostra erro com tentar de novo', async () => {
    vi.spyOn(adminPlanEntitlementsService, 'list').mockRejectedValue(new Error('x'));
    renderWithTheme(<AdminPlanEntitlementsPage />);
    expect(await screen.findByText(t.errors.load)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.retry })).toBeInTheDocument();
  });
});
