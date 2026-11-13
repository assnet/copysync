import { Box, Button, LinearProgress, Typography, alpha, useTheme } from '@mui/material';
import { RotateCcw } from 'lucide-react';
import { AppIcon } from '@/components/AppIcon';
import type { ProgressStats } from '../progress';
import { REDUCED_MOTION } from '../style';
import { tutorialsStrings as t } from '../strings';

interface Props {
  stats: ProgressStats;
  onReset: () => void;
}

const SIZE = 84;
const STROKE = 8;
const RADIUS = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * RADIUS;

/** Painel "Trilha guiada": anel e barra de conclusão, aviso de onde o progresso fica e zerar. */
export function TrailPanel({ stats, onReset }: Props) {
  const theme = useTheme();
  const complete = stats.total > 0 && stats.done === stats.total;
  const hasProgress = stats.done + stats.inProgress > 0;

  return (
    <Box
      component="section"
      aria-label={t.panel.title}
      sx={{ mb: 3, p: { xs: 2, sm: 2.5 }, borderRadius: '16px', border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { sm: 'center' }, gap: { xs: 2, sm: 3 } }}
    >
      <Box sx={{ position: 'relative', width: SIZE, height: SIZE, flexShrink: 0 }} role="img" aria-label={t.panel.ringAria(stats.percent)}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke={alpha(theme.palette.text.primary, 0.1)} strokeWidth={STROKE} />
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" strokeWidth={STROKE} strokeLinecap="round"
            stroke={complete ? theme.palette.success.main : theme.palette.primary.main}
            strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - stats.percent / 100)}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            style={{ transition: 'stroke-dashoffset .6s ease' }}
          />
        </svg>
        <Typography sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: '1.15rem', [REDUCED_MOTION]: { transition: 'none' } }}>
          {stats.percent}%
        </Typography>
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 800 }}>{t.panel.title}</Typography>
        <Typography variant="body2" color="text.secondary">{complete ? t.panel.allDone : t.panel.text}</Typography>
        <LinearProgress
          variant="determinate"
          value={stats.percent}
          color={complete ? 'success' : 'primary'}
          aria-hidden
          sx={{ mt: 1.5, height: 6, borderRadius: 3, bgcolor: alpha(theme.palette.text.primary, 0.08) }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
          {t.panel.progressLabel(stats.done, stats.total)} · {t.storageNote}
        </Typography>
      </Box>

      {hasProgress && (
        <Button size="small" color="inherit" onClick={onReset} startIcon={<AppIcon icon={RotateCcw} size="sm" />} sx={{ color: 'text.secondary', alignSelf: { xs: 'flex-start', sm: 'center' }, flexShrink: 0 }}>
          {t.resetProgress}
        </Button>
      )}
    </Box>
  );
}
