import { describe, expect, it } from 'vitest';
import { getContrastRatio } from '@mui/material/styles';
import { buildTheme } from '@/theme/theme';
import { renderWithTheme } from '@/test/renderWithTheme';
import { chartColors } from '@/features/opsMetrics/chartColors';
import { Money, srOnly, toneColor, type Tone } from './costParts';

describe('costParts', () => {
  it('srOnly usa 1px em string (número 1 no sx vira 100% e cria rolagem lateral)', () => {
    expect(srOnly.width).toBe('1px');
    expect(srOnly.height).toBe('1px');
  });

  const tones: Tone[] = ['success', 'warning', 'error', 'info'];
  it.each(['light', 'dark'] as const)('tons de texto ≥ 4,5:1 contra background.paper (%s)', (mode) => {
    const theme = buildTheme(mode);
    for (const tone of tones) {
      for (const bg of [theme.palette.background.paper, theme.palette.background.default]) {
        const ratio = getContrastRatio(toneColor(tone)(theme), bg);
        expect(ratio, `${tone} em ${mode} sobre ${bg}: ${ratio.toFixed(3)}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('margem negativa no escuro (error) passa de 4,5:1 com folga, não no arredondamento', () => {
    const theme = buildTheme('dark');
    // `getContrastRatio` arredonda a 2 casas: o `error.main` puro dá "4,50" e fica abaixo na prática (4,47:1 medido).
    expect(getContrastRatio(toneColor('error')(theme), theme.palette.background.paper)).toBeGreaterThanOrEqual(5);
  });

  it('Money: tabela empilha sempre (coluna, à direita); cartão fica lado a lado', () => {
    const { container } = renderWithTheme(
      <>
        <Money value={{ usd: 1, brl: 5 }} layout="table" />
        <Money value={{ usd: 1, brl: 5 }} />
      </>,
    );
    const [table, inline] = Array.from(container.querySelectorAll<HTMLElement>('[data-layout]'));
    expect(table.dataset.layout).toBe('table');
    expect(getComputedStyle(table).flexDirection).toBe('column');
    expect(getComputedStyle(table).alignItems).toBe('flex-end');
    expect(getComputedStyle(inline).flexWrap).toBe('wrap');
    expect(getComputedStyle(inline).flexDirection).not.toBe('column');
  });

  it.each(['light', 'dark'] as const)('neutro do gráfico (sem plano) ≥ 3:1 contra background.paper (%s)', (mode) => {
    const theme = buildTheme(mode);
    expect(getContrastRatio(chartColors(mode).other, theme.palette.background.paper)).toBeGreaterThanOrEqual(3);
  });
});
