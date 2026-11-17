import { Alert, AlertTitle, Button } from '@mui/material';
import { Gauge } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppIcon } from '@/components';
import { SAVER_PLANS_PATH } from '@/features/products/productAccess';
import { saverStrings } from '../../strings';
import type { SaverOverview } from '../../types';

const t = saverStrings.groups.limitBanner;

/** Mensagem da faixa: erro de limite vindo do pedido ou, sem ele, o primeiro limite esgotado no resumo. */
export function limitBannerMessage(overview: SaverOverview | null, errorMessage: string | null): string | null {
  if (errorMessage) return errorMessage;
  if (!overview) return null;
  const k = saverStrings.limitKeys;
  if (overview.groups.remaining === 0) return t.reached(k.saver_groups!);
  if (overview.contacts.remaining === 0) return t.reached(k.saver_contacts!);
  if (overview.groupScansPerDay.remaining === 0) return t.reached(k.saver_group_scans_per_day!);
  return null;
}

/** Faixa de limite atingido com caminho para a vitrine de planos. */
export function SaverLimitBanner({ message }: { message: string }) {
  const navigate = useNavigate();
  return (
    <Alert
      severity="warning"
      icon={<AppIcon icon={Gauge} size="md" />}
      action={<Button color="inherit" size="small" onClick={() => navigate(SAVER_PLANS_PATH)}>{t.cta}</Button>}
      sx={{ alignItems: 'center' }}
    >
      <AlertTitle sx={{ mb: 0 }}>{t.title}</AlertTitle>
      {message}
    </Alert>
  );
}
