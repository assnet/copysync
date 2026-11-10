import { IconButton, Tooltip } from '@mui/material';
import { Info } from 'lucide-react';
import { AppIcon } from '@/components';
import { opsMetricsStrings as t } from '../strings';

/** Ícone Info focável com a explicação da métrica (abre no foco e no toque). */
export function HelpTip({ label, text }: { label: string; text: string }) {
  return (
    <Tooltip title={text} enterTouchDelay={0} leaveTouchDelay={5000} arrow>
      <IconButton size="small" aria-label={t.kpi.helpAria(label)} sx={{ p: 0.25, color: 'text.secondary' }}>
        <AppIcon icon={Info} size="sm" />
      </IconButton>
    </Tooltip>
  );
}
