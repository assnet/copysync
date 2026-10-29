import { Alert } from '@mui/material';
import { plansStrings as t } from '../strings';

type NoticeFeature = keyof typeof t.featureNotice;

function isNoticeFeature(value: string | null): value is NoticeFeature {
  return value !== null && Object.prototype.hasOwnProperty.call(t.featureNotice, value);
}

/**
 * Aviso no topo de `/plans` quando o usuário chega barrado por um recurso (`?feature=`).
 * Feature desconhecida ou ausente não renderiza nada.
 */
export function PlansFeatureNotice({ feature }: { feature: string | null }) {
  if (!isNoticeFeature(feature)) return null;
  return (
    <Alert severity="info" variant="outlined" sx={{ mb: 2.5, borderRadius: 2 }}>
      {t.featureNotice[feature]}
    </Alert>
  );
}
