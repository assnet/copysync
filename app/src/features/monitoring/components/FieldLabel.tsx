import type { ReactNode } from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import { Info } from 'lucide-react';
import { AppIcon } from '@/components';
import { monitoringStrings as t } from '../strings';

interface Props {
  /** Id do rótulo, para `aria-labelledby` do controle. */
  id?: string;
  children: ReactNode;
  /** Explicação curta no tooltip do ícone de informação. */
  help?: string;
  /** Valor atual mostrado à direita do rótulo. */
  value?: ReactNode;
}

/** Rótulo de campo com ajuda em tooltip (abre no toque) e o valor escolhido alinhado à direita. */
export function FieldLabel({ id, children, help, value }: Props) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5, minHeight: 32 }}>
      <Typography id={id} variant="subtitle2" component="span" sx={{ fontWeight: 600 }}>{children}</Typography>
      {help && (
        <Tooltip title={help} arrow enterTouchDelay={0} leaveTouchDelay={4000}>
          {/* 32 px visíveis; a margem negativa + padding leva a área de toque a 44 px sem empurrar a linha. */}
          <IconButton
            size="small"
            aria-label={`${t.form.info}: ${help}`}
            sx={{
              width: 32, height: 32, color: 'text.secondary', position: 'relative',
              '&::after': { content: '""', position: 'absolute', inset: -6 },
              '&:focus-visible, &.Mui-focusVisible': { outline: (th) => `2px solid ${th.palette.primary.main}`, outlineOffset: 2 },
            }}
          >
            <AppIcon icon={Info} size="sm" />
          </IconButton>
        </Tooltip>
      )}
      {value !== undefined && (
        <Typography variant="subtitle2" component="span" sx={{ ml: 'auto', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </Typography>
      )}
    </Box>
  );
}
