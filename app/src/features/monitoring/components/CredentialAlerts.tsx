import { Box, Button, Typography, useTheme } from '@mui/material';
import { KeyRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppIcon } from '@/components';
import type { CredentialAlertItem } from '@/types/api.types';
import { INNER_RADIUS, focusRingScopeSx, iconTileSx, toneSurface } from '../monitoringStyle';
import { monitoringStrings } from '../strings';

const t = monitoringStrings.credentialAlerts;
const CREDENTIALS_PATH = '/settings/affiliate-credentials?returnTo=/monitoring';
/** Âncora usada pela etapa "Credenciais" do hero. */
export const CREDENTIAL_ALERTS_ID = 'monitoring-credentials';

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateTime.format(d);
}

/**
 * Aviso por loja no topo do monitoramento: sem credencial (capturas ignoradas) ou recusada
 * (loja pausada). Linha compacta tintada: ícone, título curto, detalhe e ação. Nada sensível aqui:
 * só o nome da loja e a data. Lista vazia não renderiza nada.
 */
export function CredentialAlerts({ alerts }: { alerts: readonly CredentialAlertItem[] | undefined }) {
  const theme = useTheme();
  const navigate = useNavigate();
  if (!alerts || alerts.length === 0) return null;
  return (
    <Box component="section" id={CREDENTIAL_ALERTS_ID} tabIndex={-1} aria-label={t.regionLabel} sx={{ scrollMarginTop: 96, '&:focus': { outline: 'none' }, ...focusRingScopeSx(theme) }}>
      <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 1 }}>
      {alerts.map((a) => {
        const name = monitoringStrings.captured.marketplace[a.provider];
        const rejected = a.kind === 'REJECTED';
        const tone = rejected ? 'error' : 'warning';
        const surface = toneSurface(theme, tone);
        const since = rejected && a.since ? t.since(when(a.since)) : null;
        return (
          <Box
            component="li"
            key={a.provider}
            sx={{
              display: 'flex', alignItems: { xs: 'stretch', sm: 'center' }, flexDirection: { xs: 'column', sm: 'row' }, gap: { xs: 1.25, sm: 1.5 },
              px: { xs: 1.5, sm: 2 }, py: 1.25, borderRadius: INNER_RADIUS, border: '1px solid',
              borderColor: surface.borderColor, bgcolor: surface.backgroundColor,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, flex: 1 }}>
              <Box sx={iconTileSx(theme, tone)}>
                <AppIcon icon={KeyRound} size="md" />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2" component="p" sx={{ fontWeight: 700, color: surface.color }}>
                  {rejected ? t.titleRejected(name) : t.titleMissing(name)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {rejected ? t.rejectedDetail : t.missingDetail} {t.hint[a.provider]}
                  {since && <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>{` ${since}.`}</Box>}
                </Typography>
              </Box>
            </Box>
            <Button
              size="small"
              variant="outlined"
              color={tone}
              aria-label={t.actionAria(name)}
              onClick={() => navigate(CREDENTIALS_PATH)}
              sx={{ flexShrink: 0, minHeight: 36, width: { xs: '100%', sm: 'auto' }, borderRadius: '10px' }}
            >
              {t.action}
            </Button>
          </Box>
        );
      })}
      </Box>
    </Box>
  );
}
