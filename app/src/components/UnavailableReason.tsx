import { Box, Typography, useTheme } from '@mui/material';
import { Lock } from 'lucide-react';
import { AppIcon } from './AppIcon';

export interface UnavailableReasonProps {
  /** Motivo curto (ex.: "Só admins podem enviar"). */
  text: string;
  /** Para `aria-describedby` da linha. */
  id?: string;
}

/**
 * Motivo de item indisponível numa lista de seleção: cadeado + texto em tom de aviso, legível em
 * claro e escuro. O motivo fica sempre visível (não depende de Tooltip).
 */
export function UnavailableReason({ text, id }: UnavailableReasonProps) {
  const theme = useTheme();
  const color = theme.palette.mode === 'dark' ? theme.palette.warning.light : theme.palette.warning.dark;
  return (
    <Typography id={id} variant="caption" component="p" sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, color, mt: 0.25 }}>
      <Box component="span" sx={{ display: 'inline-flex', pt: 0.25, flexShrink: 0 }}>
        <AppIcon icon={Lock} size="inline" />
      </Box>
      <span>{text}</span>
    </Typography>
  );
}
