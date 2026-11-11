import { Box, Tooltip, Typography } from '@mui/material';
import { RefreshCw } from 'lucide-react';
import { AppIcon } from '@/components/AppIcon';
import { affiliateLinkStrings as t, isAffiliateProvider } from '../strings';

export interface LinkRebuiltNoticeProps {
  /** Loja do link (código da API). Sem loja conhecida, o texto fica neutro. */
  provider?: string | null;
}

/**
 * Aviso discreto de que o link colado foi trocado por um da conta do usuário.
 * Nunca mostra a URL (só o nome da loja), por isso não tem flag de privacidade.
 */
export function LinkRebuiltNotice({ provider }: LinkRebuiltNoticeProps) {
  const store = isAffiliateProvider(provider) ? provider : null;
  return (
    <Tooltip title={t.rebuilt.tooltip} arrow describeChild>
      <Box
        component="span"
        role="status"
        tabIndex={0}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.75,
          color: 'text.secondary',
          borderRadius: 1,
          cursor: 'help',
          '&:focus-visible': { outline: 2, outlineColor: 'primary.main', outlineOffset: 2, outlineStyle: 'solid' },
        }}
      >
        <Box component="span" sx={{ display: 'inline-flex', color: 'info.main' }}>
          <AppIcon icon={RefreshCw} size="inline" />
        </Box>
        <Typography component="span" variant="body2">
          {t.rebuilt.notice(store)}
        </Typography>
      </Box>
    </Tooltip>
  );
}
