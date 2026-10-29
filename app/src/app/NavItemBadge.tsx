import { Box, Chip } from '@mui/material';

/**
 * Selo pequeno do item de menu (ex.: plano exigido). `stacked`: linha própria abaixo do rótulo,
 * para o rótulo não ser cortado no menu aberto; sem ele, vai à direita (tooltip do menu recolhido).
 */
export function NavItemBadge({ badge, stacked = false }: { badge?: string; stacked?: boolean }) {
  if (!badge) return null;
  return (
    <Chip
      label={badge}
      size="small"
      color="primary"
      variant="outlined"
      sx={{ ...(stacked ? { mt: 0.25 } : { ml: 1 }), height: 18, fontSize: 10, fontWeight: 600, flexShrink: 0, '& .MuiChip-label': { px: 0.75 } }}
    />
  );
}

/** Título do Tooltip no menu recolhido: o selo vai junto do rótulo. */
export function NavItemTooltip({ label, badge }: { label: string; badge?: string }) {
  if (!badge) return <>{label}</>;
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center' }}>
      <span>{label}</span>
      <NavItemBadge badge={badge} />
    </Box>
  );
}
