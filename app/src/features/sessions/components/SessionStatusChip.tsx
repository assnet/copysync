import { Chip, type ChipProps } from '@mui/material';
import type { SessionStatus } from '@/types/api.types';

interface StatusConfig {
  label: string;
  color: ChipProps['color'];
  variant: ChipProps['variant'];
}

const STATUS_CONFIG: Record<SessionStatus, StatusConfig> = {
  PENDING:          { label: 'Pendente',          color: 'default',  variant: 'outlined' },
  CONNECTING:       { label: 'Conectando…',        color: 'info',     variant: 'filled'   },
  AWAITING_QR:      { label: 'Aguardando QR',      color: 'warning',  variant: 'filled'   },
  AWAITING_PAIRING: { label: 'Aguardando código',  color: 'warning',  variant: 'filled'   },
  CONNECTED:        { label: 'Conectado',          color: 'success',  variant: 'filled'   },
  DISCONNECTED:     { label: 'Desconectado',       color: 'default',  variant: 'outlined' },
  LOGGED_OUT:       { label: 'Logout',             color: 'error',    variant: 'outlined' },
  FAILED:           { label: 'Falha',              color: 'error',    variant: 'filled'   },
};

export function SessionStatusChip({ status }: { status: SessionStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.PENDING;
  return <Chip label={cfg.label} color={cfg.color} variant={cfg.variant} size="small" />;
}

