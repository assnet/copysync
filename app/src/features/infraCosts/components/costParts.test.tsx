import { describe, expect, it } from 'vitest';
import { getContrastRatio } from '@mui/material/styles';
import { buildTheme } from '@/theme/theme';
import { srOnly, toneColor, type Tone } from './costParts';

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
});
