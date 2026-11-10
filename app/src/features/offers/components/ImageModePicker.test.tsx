import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { ImageModePicker } from './ImageModePicker';

describe('ImageModePicker', () => {
  it.each(['light', 'dark'] as const)('%s: "Imagem com legenda" desabilitada; prévia do link marcada', (mode) => {
    const onChange = vi.fn();
    renderWithTheme(<ImageModePicker value="LINK_PREVIEW" onChange={onChange} />, mode);
    const media = screen.getByRole('button', { name: 'Imagem com legenda (indisponível)' });
    expect(media).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: /Prévia do link/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(media);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('valor salvo MEDIA aparece como prévia do link, com a dica dela', () => {
    renderWithTheme(<ImageModePicker value="MEDIA" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Prévia do link/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Imagem com legenda/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/Cartão leve com a imagem acima do link/)).toBeInTheDocument();
  });

  it('tooltip explica por que "Imagem com legenda" está indisponível', async () => {
    renderWithTheme(<ImageModePicker value="LINK_PREVIEW" onChange={vi.fn()} />);
    fireEvent.mouseOver(screen.getByRole('button', { name: /Imagem com legenda/ }));
    expect(await screen.findByText('Indisponível no momento: as ofertas saem com a prévia do link.')).toBeInTheDocument();
  });
});
