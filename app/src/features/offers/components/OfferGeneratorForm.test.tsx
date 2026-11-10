import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { OfferGeneratorForm } from './OfferGeneratorForm';

beforeEach(() => sessionStorage.clear());

describe('OfferGeneratorForm sem "Reescrita com IA" no plano', () => {
  it('público salvo de IA vale como Padrão: demais travados com aviso e a geração envia STANDARD', async () => {
    sessionStorage.setItem('ui.offers.form', JSON.stringify({ v: 0, d: { url: 'https://amzn.to/abc', hasCoupon: false, coupon: '', audience: 'MOMS' } }));
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    renderWithTheme(<OfferGeneratorForm generating={false} serverError={null} onGenerate={onGenerate} aiRewriteEnabled={false} />);
    expect(screen.getByRole('radio', { name: /Padrão/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Mães/ })).toBeDisabled();
    expect(screen.getByText('Disponível nos planos PRO e MAX.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar oferta' }));
    await waitFor(() => expect(onGenerate).toHaveBeenCalled());
    expect(onGenerate.mock.calls[0]![0]).toMatchObject({ audience: 'STANDARD' });
  });
});
