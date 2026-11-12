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
      const ratio = getContrastRatio(toneColor(tone)(theme), theme.palette.background.paper);
      expect(ratio, `${tone} em ${mode}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
