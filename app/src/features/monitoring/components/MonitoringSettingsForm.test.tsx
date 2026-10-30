import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import type { GroupMonitorConfigResponse } from '@/types/api.types';
import { MonitoringSettingsForm } from './MonitoringSettingsForm';
import { settingsToDraft } from '../utils/settingsDraft';

const config: GroupMonitorConfigResponse = {
  sessionId: 's1',
  settings: {
    enabled: false, windowStartMinute: 0, windowEndMinute: 1440, intervalMinSeconds: 300, intervalMaxSeconds: 600,
    startDelaySeconds: 0, maxOfferAgeMinutes: 240, couponMaxAgeMinutes: 60, mentionAll: false, simulateTyping: true, typingSeconds: 5,
    textMode: 'ORIGINAL', audience: 'STANDARD', enrichLinkOnly: true, captureOutsideWindow: true,
  },
  monitoredGroups: [],
  broadcastGroups: [],
  limits: { monitoredGroups: 5, broadcastGroups: 10, mentionAllEnabled: false, crossSessionDispatch: false },
  usage: { monitoredGroups: 0, broadcastGroups: 0 },
};

const renderForm = (mode: 'light' | 'dark' = 'light') =>
  renderWithTheme(<MonitoringSettingsForm sessionId="s1" config={config} onSave={vi.fn().mockResolvedValue(config)} />, mode);

beforeEach(() => sessionStorage.clear());

describe('MonitoringSettingsForm', () => {
  it.each(['light', 'dark'] as const)('%s: seta no seletor de texto muda o modo, move o foco e marca o rascunho', (mode) => {
    renderForm(mode);
    const group = screen.getByRole('radiogroup', { name: 'Como montar o texto' });
    const original = within(group).getByRole('radio', { name: /Original/ });
    expect(original).toHaveAttribute('aria-checked', 'true');
    expect(original).toHaveAttribute('tabindex', '0');
    expect(screen.queryByText('Alterações não salvas')).not.toBeInTheDocument();

    fireEvent.keyDown(original, { key: 'ArrowRight' });
    const template = within(group).getByRole('radio', { name: /Modelo/ });
    expect(template).toHaveAttribute('aria-checked', 'true');
    expect(template).toHaveFocus();
    expect(original).toHaveAttribute('tabindex', '-1');
    expect(screen.getByText('Alterações não salvas')).toHaveAttribute('role', 'status');

    const stored = JSON.parse(sessionStorage.getItem('ui.monitoring.settings.s1')!) as { v: number; d: { textMode: string } };
    expect(stored).toMatchObject({ v: 4, d: { textMode: 'TEMPLATE' } });
  });

  it('clique em IA mostra o público; Descartar volta ao salvo', () => {
    renderForm();
    fireEvent.click(screen.getByRole('radio', { name: /Reescrita com IA/ }));
    expect(screen.getByRole('radiogroup', { name: 'Público-alvo' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(screen.getByRole('radio', { name: /Original/ })).toHaveAttribute('aria-checked', 'true');
    expect(sessionStorage.getItem('ui.monitoring.settings.s1')).toBeNull();
  });

  it('card mestre: switch "Monitoramento ativo" e aviso de grupos faltando ao ligar; próximos recursos sem switch', () => {
    renderForm();
    const master = screen.getByRole('checkbox', { name: 'Monitoramento ativo' });
    expect(screen.queryByText(/Escolha ao menos um grupo/)).not.toBeInTheDocument();
    fireEvent.click(master);
    expect(master).toBeChecked();
    expect(screen.getByText(/Escolha ao menos um grupo/)).toBeInTheDocument();
    expect(screen.getByText('Em breve')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Imagem/ })).not.toBeInTheDocument();
  });

  it('textos congelados da página: janela 24 h, captura travada e barra Salvar → "Configuração salva."', async () => {
    const onSave = vi.fn().mockResolvedValue(config);
    renderWithTheme(<MonitoringSettingsForm sessionId="s1" config={config} onSave={onSave} />);
    expect(screen.getByText('Sem restrição — envio 24 h')).toBeInTheDocument();
    const capture = screen.getByRole('checkbox', { name: /Capturar fora do horário/ });
    expect(capture).toBeChecked();
    expect(capture).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Monitoramento ativo/ }));
    const bar = screen.getByText('Alterações não salvas');
    fireEvent.click(within(bar.parentElement!).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Configuração salva.')).toBeInTheDocument();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, windowStartMinute: 0, windowEndMinute: 1440 }));
    await waitFor(() => expect(screen.queryByText('Alterações não salvas')).not.toBeInTheDocument());
  });

  it('"mencionar todos" travado: rascunho com true não mostra "não salvo"; salvar envia false', async () => {
    sessionStorage.setItem('ui.monitoring.settings.s1', JSON.stringify({ v: 4, d: { ...settingsToDraft(config.settings), mentionAll: true } }));
    const onSave = vi.fn().mockResolvedValue(config);
    renderWithTheme(<MonitoringSettingsForm sessionId="s1" config={config} onSave={onSave} />);
    expect(screen.queryByText('Alterações não salvas')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /Modelo/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0]).toMatchObject({ mentionAll: false, textMode: 'TEMPLATE' });
  });
});
