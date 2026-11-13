import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, AlertTitle, Box, Button, Chip, Divider, IconButton, Paper, Skeleton, Stack, Switch, Tooltip, Typography,
} from '@mui/material';
import { Bot, CalendarClock, ChevronRight, Clock, History, Pencil, Send, ShieldCheck, Trash2 } from 'lucide-react';
import { AppIcon, OverflowTooltipText } from '@/components';
import { offerHunterStrings, pauseReasonText } from '../../strings';
import type { Hunt, HuntOptions } from '../../types';
import { providerOf } from '../../providers';
import { ProviderBadge } from '../ProviderBadge';
import { isAutoPaused, lastRunLabel, nextRunLabel } from './huntSummary';
import { HuntSummaryChips } from './HuntSummaryChips';

const t = offerHunterStrings;

export interface HuntCardProps {
  hunt: Hunt;
  options: HuntOptions | null;
  nowMs: number;
  busy: boolean;
  /** Motivo (título do portão) que impede LIGAR a caçada; pausar continua livre. */
  blockedReason: string | null;
  onToggle: (active: boolean) => void;
  onEdit: () => void;
  onRemove: () => void;
}

export function HuntCard({ hunt, options, nowMs, busy, blockedReason, onToggle, onEdit, onRemove }: HuntCardProps) {
  const active = hunt.status === 'ACTIVE';
  const autoPaused = isAutoPaused(hunt);
  const cannotTurnOn = !active && blockedReason !== null;
  const switchTip = cannotTurnOn ? t.home.createBlocked(blockedReason!) : active ? t.list.pauseTooltip : t.list.resumeTooltip;
  const titleId = `hunt-${hunt.id}-title`;

  return (
    <Paper
      component="article"
      variant="outlined"
      aria-labelledby={titleId}
      sx={{
        p: { xs: 2, sm: 2.5 }, display: 'flex', flexDirection: 'column', gap: 1.5, height: '100%',
        borderLeftWidth: 4, borderLeftColor: active ? 'success.main' : autoPaused ? 'warning.main' : 'divider',
      }}
    >
      <Stack direction="row" spacing={1.25} alignItems="flex-start">
        <Box sx={{ pt: 0.25 }}><ProviderBadge provider={providerOf(hunt)} size={32} /></Box>
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <OverflowTooltipText text={hunt.name} typographyProps={{ id: titleId, variant: 'subtitle1', fontWeight: 700, component: 'h3' }} />
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.25 }} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              label={t.status[hunt.status]}
              color={active ? 'success' : autoPaused ? 'warning' : 'default'}
              variant={active ? 'filled' : 'outlined'}
            />
            {hunt.consecutiveFailures > 0 && (
              <Typography variant="caption" color="warning.main" fontWeight={600}>{t.list.failures(hunt.consecutiveFailures)}</Typography>
            )}
          </Stack>
        </Box>
        <Tooltip title={switchTip} describeChild>
          <span>
            <Switch
              checked={active}
              disabled={busy || cannotTurnOn}
              onChange={(_, checked) => onToggle(checked)}
              inputProps={{ 'aria-label': `${t.list.pauseSwitch}: ${hunt.name}` }}
            />
          </span>
        </Tooltip>
      </Stack>

      {autoPaused && hunt.pauseReason && (
        <Alert severity="warning" variant="outlined" sx={{ py: 0.25 }}>
          <AlertTitle sx={{ fontWeight: 600, mb: 0 }}>{t.autoPausedTitle}</AlertTitle>
          <Typography variant="body2">{pauseReasonText(hunt.pauseReason, providerOf(hunt))}</Typography>
        </Alert>
      )}

      <HuntSummaryChips hunt={hunt} options={options} />

      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
        <Tooltip title={t.deliveryModes[hunt.deliveryMode].hint} describeChild enterTouchDelay={0}>
          <Chip
            size="small"
            icon={<AppIcon icon={hunt.deliveryMode === 'AUTO' ? Send : ShieldCheck} size="sm" />}
            label={t.deliveryModes[hunt.deliveryMode].label}
            color={hunt.deliveryMode === 'AUTO' ? 'primary' : 'default'}
            variant="outlined"
          />
        </Tooltip>
        <Tooltip title={hunt.aiEnabled ? t.home.aiOnTooltip : t.home.aiOffTooltip} describeChild enterTouchDelay={0}>
          <Chip size="small" icon={<AppIcon icon={Bot} size="sm" />} label={hunt.aiEnabled ? t.home.aiOn : t.home.aiOff} variant="outlined" />
        </Tooltip>
        <Chip size="small" icon={<AppIcon icon={CalendarClock} size="sm" />} label={t.list.every(t.interval(hunt.intervalMinutes))} variant="outlined" />
      </Stack>

      <Box sx={{ flexGrow: 1 }} />
      <Stack spacing={0.5}>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: active ? 'text.primary' : 'text.secondary' }}>
          <AppIcon icon={Clock} size="inline" />
          <Typography variant="body2" fontWeight={active ? 600 : 400}>{nextRunLabel(hunt, nowMs)}</Typography>
        </Stack>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: 'text.secondary' }}>
          <AppIcon icon={History} size="inline" />
          <Typography variant="caption">{lastRunLabel(hunt, nowMs)}</Typography>
        </Stack>
      </Stack>

      <Divider />
      <Stack direction="row" alignItems="center" spacing={0.5} role="group" aria-label={t.home.actionsLabel(hunt.name)}>
        <Button
          component={RouterLink}
          to={`/offer-hunter/${hunt.id}`}
          size="small"
          endIcon={<AppIcon icon={ChevronRight} size="sm" />}
          sx={{ mr: 'auto' }}
        >
          {t.list.open}
        </Button>
        <Tooltip title={t.list.edit}>
          <span>
            <IconButton size="small" aria-label={`${t.list.edit}: ${hunt.name}`} onClick={onEdit} disabled={busy || !options}>
              <AppIcon icon={Pencil} size="sm" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t.list.remove}>
          <span>
            <IconButton size="small" color="error" aria-label={`${t.list.remove}: ${hunt.name}`} onClick={onRemove} disabled={busy}>
              <AppIcon icon={Trash2} size="sm" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    </Paper>
  );
}

export function HuntCardSkeleton() {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.25 }} aria-hidden>
      <Stack direction="row" justifyContent="space-between"><Skeleton width="55%" height={28} /><Skeleton variant="rounded" width={36} height={20} /></Stack>
      <Skeleton variant="rounded" width={64} height={22} />
      <Stack direction="row" spacing={0.75}><Skeleton variant="rounded" width={90} height={24} /><Skeleton variant="rounded" width={70} height={24} /></Stack>
      <Skeleton width="45%" />
      <Skeleton width="35%" />
    </Paper>
  );
}
