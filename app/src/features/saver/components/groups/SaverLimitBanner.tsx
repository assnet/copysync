import { Alert, AlertTitle, Button } from '@mui/material';
import { FlaskConical, Gauge, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppIcon } from '@/components';
import { SAVER_PLANS_PATH } from '@/features/products/productAccess';
import { saverStrings } from '../../strings';
import type { SaverOverview, SaverUsage } from '../../types';

const t = saverStrings.groups.limitBanner;

/** Esgotado de verdade: limite 0 é "fora do plano", não "usou tudo". */
const exhausted = (u: SaverUsage) => u.limit !== 0 && u.remaining === 0;

/** Conta sem plano do Saver: os três limites numéricos em 0 (preset ausente). */
export function saverWithoutPlan(overview: SaverOverview | null): boolean {
  return !!overview && [overview.groups, overview.contacts, overview.groupScansPerDay].every((u) => u.limit === 0);
}

/** Mensagem da faixa: erro de limite vindo do pedido ou, sem ele, o primeiro limite esgotado no resumo. */
export function limitBannerMessage(overview: SaverOverview | null, errorMessage: string | null): string | null {
  if (errorMessage) return errorMessage;
  if (!overview) return null;
  const k = saverStrings.limitKeys;
  if (exhausted(overview.groups)) return t.reached(k.saver_groups!);
  if (exhausted(overview.contacts)) return t.reached(k.saver_contacts!);
  if (exhausted(overview.groupScansPerDay)) return t.reached(k.saver_group_scans_per_day!);
  return null;
}

/** Conta sem plano do Saver: em vez de "0 de 0" e "limite esgotado", diz que o plano não inclui. */
export function SaverNoPlanNotice() {
  const navigate = useNavigate();
  const n = saverStrings.groups.noPlan;
  return (
    <Alert
      severity="info"
      icon={<AppIcon icon={Lock} size="md" />}
      action={<Button color="inherit" size="small" onClick={() => navigate(SAVER_PLANS_PATH)}>{n.cta}</Button>}
      sx={{ alignItems: 'center' }}
    >
      <AlertTitle>{n.title}</AlertTitle>
      {n.body}
    </Alert>
  );
}

/** SAVER-47: super admin numa conta sem o Saver; a API aplica os limites do plano MAX (`overview.pilot`). */
export function SaverPilotNotice() {
  const p = saverStrings.groups.pilot;
  return (
    <Alert severity="info" icon={<AppIcon icon={FlaskConical} size="md" />} sx={{ alignItems: 'center' }}>
      <AlertTitle>{p.title}</AlertTitle>
      {p.body}
    </Alert>
  );
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
