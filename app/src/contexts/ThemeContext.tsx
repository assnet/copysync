import { createContext, useContext, useState, useMemo, type ReactNode } from 'react';
import { ThemeProvider, CssBaseline, type PaletteMode } from '@mui/material';
import { buildTheme } from '@/theme/theme';

interface ThemeContextValue {
  mode: PaletteMode;
  toggleColorMode: () => void;
}

const ThemeCtx = createContext<ThemeContextValue | null>(null);

export function ColorModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<PaletteMode>(() => {
    const stored = localStorage.getItem('colorMode');
    return stored === 'dark' ? 'dark' : 'light';
  });

  const toggleColorMode = () => {
    setMode((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      localStorage.setItem('colorMode', next);
      return next;
    });
  };

  const theme = useMemo(() => buildTheme(mode), [mode]);

  return (
    <ThemeCtx.Provider value={{ mode, toggleColorMode }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeCtx.Provider>
  );
}

export function useColorMode(): ThemeContextValue {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useColorMode deve ser usado dentro de ColorModeProvider');
  return ctx;
}
