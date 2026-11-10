import { Chip } from '@mui/material';
import { CircleCheck, CircleDashed, OctagonAlert, TriangleAlert } from 'lucide-react';
import { AppIcon } from '@/components';
import { opsMetricsStrings as t } from '../strings';
import type { OpsStatus } from '../types';

const CONFIG = {
  ok: { color: 'success', variant: 'outlined', icon: CircleCheck },
  warning: { color: 'warning', variant: 'outlined', icon: TriangleAlert },
  critical: { color: 'error', variant: 'filled', icon: OctagonAlert },
  noData: { color: 'default', variant: 'outlined', icon: CircleDashed },
} as const;

/** Status sempre com ícone + palavra (nunca só cor). */
export function StatusChip({ status }: { status: OpsStatus }) {
  const c = CONFIG[status];
  return (
    <Chip
      size="small"
      color={c.color}
      variant={c.variant}
      icon={<AppIcon icon={c.icon} size="sm" aria-hidden />}
      label={t.status[status]}
      sx={{ fontWeight: 600 }}
    />
  );
}
