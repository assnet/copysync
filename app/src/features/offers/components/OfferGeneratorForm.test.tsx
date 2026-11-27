import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { AFFILIATE_PLANS_PATH } from '@/features/navigation';
import { SUPPORT_CHAT_PATH } from '@/features/platformLinks/links';
import { offerStrings } from '../strings';
import { OfferGeneratorForm } from './OfferGeneratorForm';

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

const renderForm = (ui: ReactElement) => renderWithTheme(<MemoryRouter>{ui}</MemoryRouter>);

describe('OfferGeneratorForm sem "Reescrita com IA" no plano', () => {
  it('público salvo de IA vale como Padrão: demais travados com aviso e a geração envia STANDARD', async () => {
    sessionStorage.setItem('ui.offers.form', JSON.stringify({ v: 0, d: { url: 'https://amzn.to/abc', hasCoupon: false, coupon: '', audience: 'MOMS' } }));
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    renderForm(<OfferGeneratorForm generating={false} serverError={null} onGenerate={onGenerate} aiRewriteEnabled={false} />);
    expect(screen.getByRole('radio', { name: /Padrão/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Mães/ })).toBeDisabled();
    expect(screen.getByText('Disponível nos planos PRO e MAX.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar oferta' }));
    await waitFor(() => expect(onGenerate).toHaveBeenCalled());
    expect(onGenerate.mock.calls[0]![0]).toMatchObject({ audience: 'STANDARD' });
  });
});

describe('OfferGeneratorForm com loja fora do plano', () => {
  const t = offerStrings.form;
  const visible = ['SHOPEE', 'MERCADO_LIVRE', 'AMAZON', 'SHEIN', 'KABUM'] as const;
  const locked = { KABUM: { enabled: false, plans: ['COPYSYNC_MAX'], riskNotice: null } };
  const paste = (url: string) => fireEvent.change(screen.getByLabelText(t.linkLabel), { target: { value: url } });

  it('chip de aviso com o plano, ações de upgrade e envio bloqueado', () => {
    const onGenerate = vi.fn();
    renderForm(<OfferGeneratorForm generating={false} serverError={null} onGenerate={onGenerate} visibleStores={visible} storeAvailability={locked} />);
    paste('https://www.kabum.com.br/produto/1');
    const chip = screen.getByText(t.notInPlan.chip('Kabum', ['MAX'])).closest('.MuiChip-root');
    expect(chip).toHaveClass('MuiChip-colorWarning');
    expect(screen.queryByText(t.detected('Kabum'))).not.toBeInTheDocument();
    expect(screen.getByText(t.notInPlan.helper('Kabum'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t.notInPlan.plans })).toHaveAttribute('href', AFFILIATE_PLANS_PATH);
    const support = screen.getByRole('link', { name: t.notInPlan.support });
    expect(support).toHaveAttribute('href', SUPPORT_CHAT_PATH);
    expect(support).toHaveAttribute('target', '_blank');
    expect(support.getAttribute('rel')).toContain('noopener');
    const submit = screen.getByRole('button', { name: t.submit });
    expect(submit).toBeDisabled();
    fireEvent.submit(submit.closest('form')!);
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('loja escondida pela audiência segue "Loja não reconhecida"', async () => {
    const onGenerate = vi.fn();
    renderForm(<OfferGeneratorForm generating={false} serverError={null} onGenerate={onGenerate} visibleStores={['SHOPEE', 'AMAZON']} storeAvailability={locked} />);
    paste('https://www.kabum.com.br/produto/1');
    expect(screen.queryByText(t.notInPlan.plans)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t.submit }));
    expect(await screen.findByText(t.linkUnknownStore(['Shopee', 'Amazon']))).toBeInTheDocument();
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('403 de plano da API mostra o mesmo caminho de upgrade', () => {
    renderForm(<OfferGeneratorForm generating={false} serverError="A Kabum não está liberada no seu plano." serverPlanStore="KABUM" onGenerate={vi.fn()} visibleStores={visible} />);
    paste('https://www.kabum.com.br/produto/1');
    expect(screen.getByText(t.notInPlan.chip('Kabum', []))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t.notInPlan.plans })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.submit })).toBeDisabled();
  });

  it('ajuda lista só as lojas visíveis', () => {
    renderForm(<OfferGeneratorForm generating={false} serverError={null} onGenerate={vi.fn()} visibleStores={visible} />);
    expect(screen.getByText(t.linkHelper(['Shopee', 'Mercado Livre', 'Amazon', 'Shein', 'Kabum']))).toBeInTheDocument();
  });
});
