import { alpha, type SxProps, type Theme } from '@mui/material';

/** Reduz movimento quando o sistema pede: usado em chevron, Collapse e Popover do menu. */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
export const NAV_MOTION_MS = 200;

const focusRing = {
  '&.Mui-focusVisible': {
    outline: '2px solid',
    outlineColor: 'primary.main',
    outlineOffset: -2,
  },
};

/**
 * Alvo de toque de 44px no mobile e indicador lateral no item ativo (o `selected` do MUI
 * sozinho não deixa evidente). Foco por teclado visível com anel em `primary`.
 */
export function navButtonSx(collapsed: boolean): SxProps<Theme> {
  return {
    borderRadius: 2,
    position: 'relative',
    minHeight: { xs: 44, sm: 38 },
    ...(collapsed ? { py: 0.75, px: 1, justifyContent: 'center' } : { py: 0.5, px: 1.5 }),
    ...focusRing,
    '&.Mui-selected::before': {
      content: '""',
      position: 'absolute',
      left: 0,
      top: '50%',
      transform: 'translateY(-50%)',
      width: 3,
      height: '60%',
      borderRadius: 4,
      bgcolor: 'primary.main',
    },
  };
}

export function navIconSx(collapsed: boolean): SxProps<Theme> {
  return collapsed
    ? { minWidth: 0, justifyContent: 'center', '& svg': { width: 22, height: 22 } }
    : { minWidth: 36, '& svg': { width: 20, height: 20 } };
}

/** Filho de produto: mais baixo, ícone menor, destaque suave quando ativo. */
export const navChildButtonSx: SxProps<Theme> = {
  borderRadius: 1.5,
  minHeight: { xs: 44, sm: 34 },
  py: 0.5,
  pl: 1.25,
  pr: 1,
  ...focusRing,
  '&.Mui-selected': {
    bgcolor: (t) => alpha(t.palette.primary.main, 0.1),
    color: 'primary.main',
    '& .MuiListItemIcon-root': { color: 'primary.main' },
  },
  '&.Mui-selected:hover': {
    bgcolor: (t) => alpha(t.palette.primary.main, 0.16),
  },
};

export const navChildIconSx: SxProps<Theme> = { minWidth: 30, '& svg': { width: 18, height: 18 } };

/** Espaço entre itens do menu. */
export const NAV_ITEM_GAP = 0.125;

/** Título de seção ("Produtos", "Plataforma"). */
export const navSectionTitleSx: SxProps<Theme> = {
  px: 2.5,
  mt: 1.5,
  mb: 0.25,
  display: 'block',
  color: 'text.secondary',
  fontWeight: 700,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.8,
};

/** Chip "Em breve" inline à direita do rótulo. */
export const navSoonChipSx: SxProps<Theme> = {
  ml: 0.75,
  height: 18,
  fontSize: 10,
  fontWeight: 600,
  flexShrink: 0,
  color: 'text.secondary',
  borderColor: 'divider',
  '& .MuiChip-label': { px: 0.625 },
};
