import { Alert, Box, Button, Chip, CircularProgress, FormControlLabel, Stack, Switch, Tooltip, Typography } from '@mui/material';
import { Pencil, Play } from 'lucide-react';
import { AppIcon } from '@/components';
import type { Hunt, HuntGateKey } from '../../types';
import { offerHunterStrings as t } from '../../strings';
import { formatDateTime } from '../../format';

const d = t.detail;

interface Props {
  hunt: Hunt;
  /** Primeiro portão fechado (sem plano, sem credencial…): trava ligar e rodar. */
  blockedBy: HuntGateKey | null;
  running: boolean;
  toggling: boolean;
  onToggle: (active: boolean) => void;
  onRun: () => void;
  onEdit: () => void;
}

/** Nome, estado, liga/desliga, "Rodar agora" e "Editar". Pausa automática vira alerta. */
export function HuntDetailHeader({ hunt, blockedBy, running, toggling, onToggle, onRun, onEdit }: Props) {
  const active = hunt.status === 'ACTIVE';
  const gateText = blockedBy ? d.gatedTooltip(t.gates[blockedBy].title) : null;
  const autoPaused = hunt.status === 'PAUSED' && hunt.pauseReason && hunt.pauseReason !== 'USER';
  const next = active ? formatDateTime(hunt.nextRunAt) : null;
  const lastRun = formatDateTime(hunt.lastRunAt);

  const toggle = (
    <FormControlLabel
      control={<Switch checked={active} disabled={toggling || (!active && blockedBy !== null)} onChange={(_e, v) => onToggle(v)} />}
      label={d.activeSwitch}
      sx={{ ml: 0, gap: 1, mr: 0 }}
    />
  );

  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: { xs: 'stretch', md: 'flex-start' }, gap: 2 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="h5" component="h1" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{hunt.name}</Typography>
            <Chip size="small" color={active ? 'success' : 'default'} variant={active ? 'filled' : 'outlined'} label={t.status[hunt.status]} />
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {[
              t.list.every(t.interval(hunt.intervalMinutes)),
              t.deliveryModes[hunt.deliveryMode].label,
              next ? `${t.list.nextRun}: ${next}` : t.list.nextRunNone,
              lastRun ? `${t.list.lastRun}: ${lastRun}` : t.list.lastRunNever,
            ].join(' · ')}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          {gateText && !active ? (
            <Tooltip title={gateText} arrow describeChild><span>{toggle}</span></Tooltip>
          ) : toggle}
          <Tooltip title={gateText ?? d.runNowTooltip} arrow describeChild>
            <span>
              <Button
                variant="contained"
                disableElevation
                onClick={onRun}
                disabled={running || blockedBy !== null}
                startIcon={running ? <CircularProgress size={16} color="inherit" /> : <AppIcon icon={Play} size="sm" />}
              >
                {running ? d.running : d.runNow}
              </Button>
            </span>
          </Tooltip>
          <Tooltip title={d.editTooltip} arrow describeChild>
            <Button variant="outlined" onClick={onEdit} startIcon={<AppIcon icon={Pencil} size="sm" />}>{d.edit}</Button>
          </Tooltip>
        </Stack>
      </Box>
      {autoPaused && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          <strong>{t.autoPausedTitle}.</strong> {t.pauseReasons[hunt.pauseReason!]}
        </Alert>
      )}
    </Box>
  );
}
