import { alpha, type SxProps, type Theme } from '@mui/material';

/**
 * Estilo da tela Grupos do Saver. Só tokens do tema + `alpha()`: igual em claro, escuro e sistema.
 */
type Sx = Exclude<SxProps<Theme>, ReadonlyArray<unknown> | ((theme: Theme) => unknown)>;

/** Linha marcada: fundo primário suave e filete à esquerda (não depende só da cor do checkbox). */
export function selectedRowSx(theme: Theme): Sx {
  return {
    bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.07),
    boxShadow: `inset 3px 0 0 ${theme.palette.primary.main}`,
  };
}

/**
 * Barra de ações presa ao rodapé da área visível enquanto houver grupo marcado. A página é a única
 * rolagem; o botão de suporte sobe nesta rota (`SUPPORT_CHAT_RAISED_PATHS`) para não cobri-la.
 */
export function selectionBarSx(theme: Theme, sticky: boolean): Sx {
  if (!sticky) return {};
  const dark = theme.palette.mode === 'dark';
  return {
    position: 'sticky',
    bottom: 12,
    zIndex: theme.zIndex.appBar - 1,
    bgcolor: 'background.paper',
    border: 1,
    borderColor: alpha(theme.palette.primary.main, dark ? 0.45 : 0.3),
    borderRadius: 3,
    boxShadow: dark
      ? `0 12px 28px -12px ${alpha(theme.palette.common.black, 0.85)}`
      : `0 12px 28px -14px ${alpha(theme.palette.text.primary, 0.35)}`,
    px: { xs: 1.5, sm: 2 },
    py: 1.25,
  };
}
