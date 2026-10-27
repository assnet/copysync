import { Chip, type ChipProps } from '@mui/material';
import type { ExtensionStatus } from '../hooks/useExtension';
import { extensionStrings } from '../strings';

const t = extensionStrings.settings;

const CONFIG: Record<ExtensionStatus, { label: string; color: ChipProps['color'] }> = {
  connected: { label: t.statusConnected, color: 'success' },
  detected: { label: t.statusDetected, color: 'warning' },
  not_detected: { label: t.statusNotDetected, color: 'default' },
  unavailable: { label: t.statusUnavailable, color: 'default' },
  error: { label: 'Erro', color: 'error' },
};

interface Props {
  status: ExtensionStatus;
}

export function ExtensionStatusBadge({ status }: Props) {
  const cfg = CONFIG[status];
  return <Chip label={cfg.label} color={cfg.color} size="small" variant="outlined" />;
}
