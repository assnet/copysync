import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const risk = vi.hoisted(() => ({ acceptRisk: vi.fn() }));
vi.mock('@/services/affiliateCredential.service', () => ({ affiliateCredentialService: risk }));

import { HunterRiskNoticeDialog } from './HunterRiskNoticeDialog';
import { offerHunterStrings as t } from '../strings';

const n = t.riskNotice;
const confirmBtn = () => screen.getByRole('button', { name: n.confirm });
const box = () => screen.getByRole('checkbox', { name: n.checkbox });

beforeEach(() => vi.clearAllMocks());

describe('HunterRiskNoticeDialog', () => {
  it('caixa nasce desmarcada e o botão só libera ao marcar; aceite envia versão, locale e scope', async () => {
    risk.acceptRisk.mockResolvedValue({ acceptedAt: '2026-11-12T10:00:00Z' });
    const onAccepted = vi.fn();
    render(<HunterRiskNoticeDialog open canAccept onClose={vi.fn()} onAccepted={onAccepted} />);
    for (const p of n.paragraphs) expect(screen.getByText(p)).toBeInTheDocument();
    expect(box()).not.toBeChecked();
    expect(confirmBtn()).toBeDisabled();
    fireEvent.click(box());
    expect(confirmBtn()).toBeEnabled();
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(onAccepted).toHaveBeenCalled());
    expect(risk.acceptRisk).toHaveBeenCalledWith('SHEIN', { noticeVersion: n.version, locale: n.locale, scope: 'OFFER_HUNTER' });
  });

  it('papel não admin lê o texto com caixa e botão desabilitados e o pedido ao administrador', () => {
    render(<HunterRiskNoticeDialog open canAccept={false} onClose={vi.fn()} onAccepted={vi.fn()} />);
    expect(box()).toBeDisabled();
    expect(confirmBtn()).toBeDisabled();
    expect(screen.getByText(t.gatesPanel.askAdmin)).toBeInTheDocument();
  });

  it('super admin não aceita mesmo com papel ADMIN', () => {
    render(<HunterRiskNoticeDialog open canAccept isSuperAdmin onClose={vi.fn()} onAccepted={vi.fn()} />);
    expect(confirmBtn()).toBeDisabled();
    expect(screen.getByText(t.gatesPanel.superAdminCannot)).toBeInTheDocument();
  });

  it('versão desatualizada: recarrega opções e troca o aceite por "Recarregar página"', async () => {
    risk.acceptRisk.mockRejectedValue({ code: 'MARKETPLACE_RISK_NOTICE_OUTDATED' });
    const onStale = vi.fn();
    render(<HunterRiskNoticeDialog open canAccept onClose={vi.fn()} onAccepted={vi.fn()} onStale={onStale} />);
    fireEvent.click(box());
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(onStale).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: n.reloadPage })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: n.confirm })).toBeNull();
  });

  it('reabrir desmarca a caixa', () => {
    const { rerender } = render(<HunterRiskNoticeDialog open canAccept onClose={vi.fn()} onAccepted={vi.fn()} />);
    fireEvent.click(box());
    rerender(<HunterRiskNoticeDialog open={false} canAccept onClose={vi.fn()} onAccepted={vi.fn()} />);
    rerender(<HunterRiskNoticeDialog open canAccept onClose={vi.fn()} onAccepted={vi.fn()} />);
    expect(box()).not.toBeChecked();
  });
});
