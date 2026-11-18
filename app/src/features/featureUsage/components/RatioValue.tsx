import { Box, Tooltip } from '@mui/material';
import type { UsageRatioCell } from '../rules';

/**
 * Valor de adoção, recorrência ou retenção com o denominador (ou o motivo do "—") no `Tooltip`, que abre no foco e
 * no toque. O leitor de tela ouve valor e dica juntos.
 */
export function RatioValue({ cell, label }: { cell: UsageRatioCell; label: string }) {
  return (
    <Tooltip title={cell.hint} arrow enterTouchDelay={0} leaveTouchDelay={5000}>
      <Box
        component="span"
        tabIndex={0}
        aria-label={`${label}: ${cell.value}. ${cell.hint}`}
        sx={{
          cursor: 'help',
          color: cell.missing ? 'text.disabled' : 'inherit',
          borderBottom: cell.missing ? 0 : 1,
          borderBottomStyle: 'dotted',
          borderBottomColor: 'text.disabled',
          '&:focus-visible': { outline: 2, outlineStyle: 'solid', outlineColor: 'primary.main', outlineOffset: 2, borderRadius: 0.5 },
        }}
      >
        {cell.value}
      </Box>
    </Tooltip>
  );
}
