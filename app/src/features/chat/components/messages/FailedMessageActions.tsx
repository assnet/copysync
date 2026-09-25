import { Box, Button, Typography, alpha, useTheme } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import type { MessageUploadState } from '../../types';
import { chatStrings } from '../../strings';

/** Falha local da bolha otimista (`upload.error`) ou `server` (mensagem gravada com `failed`). */
export type FailedMessageKind = NonNullable<MessageUploadState['error']> | 'server';

interface Props {
  kind: FailedMessageKind;
  onRetry?: () => void;
  onDiscard?: () => void;
}

const REASON: Record<FailedMessageKind, string> = {
  network: chatStrings.upload.errors.network,
  session: chatStrings.upload.errors.sessionDisconnected,
  rejected: chatStrings.upload.errors.rejected,
  server: chatStrings.upload.errors.generic,
};

/**
 * Causa + ações de uma mídia que não foi enviada (design §14, tabela do estado otimista).
 * `rejected` não se resolve repetindo; `server` já está gravada — não há o que descartar no painel.
 * Superfície própria (`background.paper`): a bolha enviada é `primary`, onde o vermelho não lê.
 */
export function FailedMessageActions({ kind, onRetry, onDiscard }: Props) {
  const theme = useTheme();
  const t = chatStrings.upload;
  const canRetry = kind !== 'rejected' && !!onRetry;
  const canDiscard = kind !== 'server' && !!onDiscard;

  const btnSx = {
    minHeight: 40,
    px: 1.5,
    textTransform: 'none',
    fontWeight: 600,
    '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
  } as const;

  return (
    <Box
      role="group"
      aria-label={t.failed}
      sx={{
        mt: 1,
        p: 1,
        borderRadius: 1.5,
        bgcolor: theme.palette.background.paper,
        border: `1px solid ${alpha(theme.palette.error.main, 0.45)}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
        <ErrorOutlineIcon aria-hidden sx={{ fontSize: 18, mt: '1px', color: theme.palette.error.main }} />
        <Typography role="status" variant="body2" sx={{ color: theme.palette.text.primary, lineHeight: 1.4 }}>
          {REASON[kind]}
        </Typography>
      </Box>
      {(canRetry || canDiscard) && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 0.5 }}>
          {canDiscard && (
            <Button onClick={onDiscard} color="inherit" sx={{ ...btnSx, color: theme.palette.text.secondary }}>
              {t.discard}
            </Button>
          )}
          {canRetry && (
            <Button onClick={onRetry} variant="contained" disableElevation startIcon={<RefreshIcon />} sx={btnSx}>
              {t.retry}
            </Button>
          )}
        </Box>
      )}
    </Box>
  );
}
