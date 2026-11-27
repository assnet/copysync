import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WatermarkOverlay, type WatermarkOverlayMark } from './WatermarkOverlay';

const mark = (over: Partial<WatermarkOverlayMark> = {}): WatermarkOverlayMark => ({
  kind: 'IMAGE', text: null, position: 'TOP_RIGHT', size: 'MEDIUM', opacity: 80, ...over,
});

const box = () => screen.getByTestId('watermark-mark');

describe('WatermarkOverlay', () => {
  it('foto 1200×600 TOP_RIGHT: x em % da largura, y em % da altura', () => {
    // lado menor 600: margem 24, logo (quadrado até carregar) 132 px → left 1044, top 24
    render(<WatermarkOverlay mark={mark()} logoUrl="https://cdn/logo.png" photo={{ width: 1200, height: 600 }} />);
    const style = getComputedStyle(box());
    expect(parseFloat(style.left)).toBeCloseTo(87);
    expect(parseFloat(style.top)).toBeCloseTo(4);
    expect(parseFloat(style.width)).toBeCloseTo(11);
    expect(parseFloat(style.height)).toBeCloseTo(22);
    expect(box()).toHaveStyle({ opacity: '0.8' });
    expect(box().querySelector('img')).toHaveAttribute('src', 'https://cdn/logo.png');
  });

  it('texto: desenha o SVG com o texto; sem texto e sem placeholder, nada', () => {
    const { rerender } = render(<WatermarkOverlay mark={mark({ kind: 'TEXT', text: 'Minha Loja' })} logoUrl={null} photo={{ width: 600, height: 600 }} />);
    expect(box().querySelector('svg text')?.textContent).toBe('Minha Loja');
    rerender(<WatermarkOverlay mark={mark({ kind: 'TEXT', text: '  ' })} logoUrl={null} photo={{ width: 600, height: 600 }} />);
    expect(screen.queryByTestId('watermark-mark')).toBeNull();
  });

  it('logo ausente mostra o placeholder', () => {
    render(<WatermarkOverlay mark={mark()} logoUrl={null} photo={{ width: 600, height: 600 }} placeholder={<span>vazio</span>} />);
    expect(box().textContent).toBe('vazio');
  });
});
