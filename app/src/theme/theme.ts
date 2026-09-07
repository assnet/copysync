import { createTheme, type PaletteMode } from '@mui/material/styles';

const FONT_STACK = [
  'Inter',
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  'Roboto',
  'sans-serif',
].join(',');

export function buildTheme(mode: PaletteMode) {
  const isDark = mode === 'dark';

  return createTheme({
    palette: {
      mode,
      primary:   { main: '#4f70e0', light: '#7b95e8', dark: '#2b4ccb', contrastText: '#fff' },
      secondary: { main: '#7c3aed', light: '#a56cf0', dark: '#5b22c4', contrastText: '#fff' },
      success:   { main: '#22c55e', light: '#4ade80', dark: '#16a34a' },
      warning:   { main: '#f59e0b', light: '#fbbf24', dark: '#d97706' },
      error:     { main: '#ef4444', light: '#f87171', dark: '#dc2626' },
      info:      { main: '#3b82f6', light: '#60a5fa', dark: '#2563eb' },
      background: isDark
        ? { default: '#0f1117', paper: '#1a1d27' }
        : { default: '#f4f6fb', paper: '#ffffff' },
      divider: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)',
      text: isDark
        ? { primary: '#e8eaf0', secondary: '#9096a8', disabled: '#555b6e' }
        : { primary: '#0f1117', secondary: '#5a6478', disabled: '#aab0be' },
    },

    typography: {
      fontFamily: FONT_STACK,
      h4: { fontWeight: 800, letterSpacing: -0.5 },
      h5: { fontWeight: 700, letterSpacing: -0.3 },
      h6: { fontWeight: 700 },
      subtitle1: { fontWeight: 600 },
      subtitle2: { fontWeight: 600 },
      body2: { lineHeight: 1.6 },
      caption: { letterSpacing: 0.2 },
    },

    shape: { borderRadius: 12 },

    components: {
      MuiCssBaseline: {
        styleOverrides: {
          html: { WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' },
          '*::-webkit-scrollbar': { width: 6, height: 6 },
          '*::-webkit-scrollbar-track': { background: 'transparent' },
          '*::-webkit-scrollbar-thumb': {
            background: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)',
            borderRadius: 4,
          },
        },
      },

      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { textTransform: 'none', fontWeight: 600, borderRadius: 10 },
          sizeLarge: { fontSize: '0.9375rem', padding: '10px 24px' },
        },
      },

      MuiCard: {
        defaultProps: { variant: 'outlined' },
        styleOverrides: {
          root: {
            boxShadow: 'none',
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'}`,
            transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
          },
        },
      },

      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
          outlined: {
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'}`,
          },
        },
      },

      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: isDark ? '#13161f' : '#ffffff',
            borderRight: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)'}`,
          },
        },
      },

      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: isDark ? '#13161f' : '#ffffff',
            borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)'}`,
            color: isDark ? '#e8eaf0' : '#0f1117',
          },
        },
      },

      MuiTextField: {
        defaultProps: { size: 'small', variant: 'outlined' },
        styleOverrides: {
          root: { '& .MuiOutlinedInput-root': { borderRadius: 10 } },
        },
      },

      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: 10 },
          notchedOutline: {
            borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.15)',
          },
        },
      },

      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 600, borderRadius: 8 },
        },
      },

      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 10,
            '&.Mui-selected': {
              backgroundColor: isDark ? 'rgba(79,112,224,0.18)' : 'rgba(79,112,224,0.10)',
              color: '#4f70e0',
              '& .MuiListItemIcon-root': { color: '#4f70e0' },
              '&:hover': {
                backgroundColor: isDark ? 'rgba(79,112,224,0.25)' : 'rgba(79,112,224,0.16)',
              },
            },
          },
        },
      },

      MuiDivider: {
        styleOverrides: {
          root: { borderColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)' },
        },
      },

      MuiTooltip: {
        defaultProps: { arrow: true },
        styleOverrides: {
          tooltip: { fontSize: '0.75rem', borderRadius: 8 },
        },
      },

      MuiAlert: {
        styleOverrides: { root: { borderRadius: 10 } },
      },

      MuiDialog: {
        styleOverrides: {
          paper: { borderRadius: 16 },
        },
      },

      MuiIconButton: {
        styleOverrides: {
          root: { borderRadius: 10 },
        },
      },
    },
  });
}

// Compatibilidade com imports legados
export const theme = buildTheme('light');

