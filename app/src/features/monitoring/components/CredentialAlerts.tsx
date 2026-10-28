import { Alert, AlertTitle, Button, Stack } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import type { CredentialAlertItem } from '@/types/api.types';
import { monitoringStrings } from '../strings';

const t = monitoringStrings.credentialAlerts;
const CREDENTIALS_PATH = '/settings/affiliate-credentials?returnTo=/monitoring';

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateTime.format(d);
}

/**
 * Aviso fixo por loja no topo do monitoramento: sem credencial (capturas ignoradas) ou recusada
 * (loja pausada). Nada sensível aqui: só o nome da loja e a data. Lista vazia não renderiza nada.
 */
export function CredentialAlerts({ alerts }: { alerts: readonly CredentialAlertItem[] | undefined }) {
  const navigate = useNavigate();
  if (!alerts || alerts.length === 0) return null;
  return (
    <Stack spacing={1.5} role="region" aria-label={monitoringStrings.captured.title}>
      {alerts.map((a) => {
        const name = monitoringStrings.captured.marketplace[a.provider];
        return (
          <Alert
            key={a.provider}
            severity={a.kind === 'REJECTED' ? 'error' : 'warning'}
            action={
              <Button color="inherit" size="small" aria-label={t.actionAria(name)} onClick={() => navigate(CREDENTIALS_PATH)}>
                {t.action}
              </Button>
            }
          >
            <AlertTitle sx={{ fontWeight: 700 }}>
              {a.kind === 'REJECTED' ? t.rejected(name, when(a.since)) : t.missing(name)}
            </AlertTitle>
            {t.hint[a.provider]}
          </Alert>
        );
      })}
    </Stack>
  );
}
