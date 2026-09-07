import type { ReactElement } from 'react';
import type { PaletteMode } from '@mui/material';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { render, type RenderResult } from '@testing-library/react';
import { buildTheme } from '@/theme/theme';

/**
 * Renderiza um componente dentro do tema do painel.
 *
 * Componentes que usam `useTheme()` quebram fora de um `ThemeProvider`, e como toda tela
 * precisa funcionar em claro e escuro, o modo é parâmetro — o mesmo teste roda nos dois.
 */
export function renderWithTheme(ui: ReactElement, mode: PaletteMode = 'light'): RenderResult {
  return render(
    <ThemeProvider theme={buildTheme(mode)}>
      <CssBaseline />
      {ui}
    </ThemeProvider>,
  );
}
