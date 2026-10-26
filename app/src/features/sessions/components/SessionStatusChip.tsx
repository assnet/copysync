import { Chip, type ChipProps } from '@mui/material';
import type { SessionStatus } from '@/types/api.types';
import { sessionStrings } from '../strings';

interface StatusConfig {
  color: ChipProps['color'];
  variant: ChipProps['variant'];
}

const STATUS_CONFIG: Record<SessionStatus, StatusConfig> = {
  PENDING:          { color: 'default',  variant: 'outlined' },
  CONNECTING:       { color: 'info',     variant: 'filled'   },
  AWAITING_QR:      { color: 'warning',  variant: 'filled'   },
  AWAITING_PAIRING: { color: 'warning',  variant: 'filled'   },
  CONNECTED:        { color: 'success',  variant: 'filled'   },
  DISCONNECTED:     { color: 'default',  variant: 'outlined' },
  LOGGED_OUT:       { color: 'error',    variant: 'outlined' },
  FAILED:           { color: 'error',    variant: 'filled'   },
};

export function SessionStatusChip({ status }: { status: SessionStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.PENDING;
  return <Chip label={sessionStrings.status[status] ?? sessionStrings.status.PENDING} color={cfg.color} variant={cfg.variant} size="small" />;
}

