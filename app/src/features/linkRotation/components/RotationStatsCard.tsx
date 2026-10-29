import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, IconButton, LinearProgress, Skeleton, Stack, Tooltip, Typography,
  type ChipProps, type LinearProgressProps,
} from '@mui/material';
import { RefreshCw } from 'lucide-react';
import { AppIcon } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { linkRotationService } from '@/services/linkRotation.service';
import { serverNow } from '@/services/serverClock';
import { linkRotationErrorMessage } from '@/utils/linkRotationErrors';
import { linkRotationStrings } from '../strings';
import type { RotationGroupStats, RotationGroupStatus, RotationStats } from '../types';

const t = linkRotationStrings.stats;

/** Status que ganham chip na lista; ACTIVE é o normal e não polui a linha. */
const STATUS_CHIP: Partial<Record<RotationGroupStatus, ChipProps['color']>> = {
  FULL: 'warning',
  NEEDS_LINK: 'error',
  PAUSED_BY_PLAN: 'warning',
  PAUSED: 'default',
};

/** Faixa da ocupação → token de cor do tema (o número fica sempre ao lado: nunca só cor). */
export function occupancyColor(pct: number): LinearProgressProps['color'] {
  if (pct >= 90) return 'error';
  if (pct >= 70) return 'warning';
  return 'success';
}

export interface RotationStatsCardProps {
  /** Id do rodízio; o card busca `GET /link-rotation/:id/stats` por conta própria. */
  rotationId: string;
  /** Muda quando os grupos/estado do rodízio mudam no painel: recarrega sem piscar o esqueleto. */
  refreshKey?: string;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; stats: RotationStats };

/** Área de cliques do card: total, 7 dias, último clique e ocupação/cliques por grupo. */
export function RotationStatsCard({ rotationId, refreshKey }: RotationStatsCardProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  // Só a resposta do pedido mais recente vale (troca de rotationId ou cliques seguidos).
  const reqId = useRef(0);

  const load = useCallback(async (soft: boolean) => {
    const id = ++reqId.current;
    if (soft) setRefreshing(true);
    else setState({ kind: 'loading' });
    try {
      const stats = await linkRotationService.getStats(rotationId);
      if (id === reqId.current) setState({ kind: 'ready', stats });
    } catch (err) {
      if (id === reqId.current) setState({ kind: 'error', message: linkRotationErrorMessage(err) || t.loadError });
    } finally {
      if (id === reqId.current) setRefreshing(false);
    }
  }, [rotationId]);

  useEffect(() => {
    void load(false);
    return () => { reqId.current++; };
  }, [load]);

  // Salvar grupos/pausar atualiza o overview; os números por grupo vêm de outra rota.
  const lastKey = useRef(refreshKey);
  useEffect(() => {
    if (lastKey.current === refreshKey) return;
    lastKey.current = refreshKey;
    void load(true);
  }, [refreshKey, load]);

  return (
    <Box component="section" aria-label={t.title}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5, minHeight: 30 }}>
        <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.5 }}>{t.title}</Typography>
        {state.kind === 'ready' && (
          <Tooltip title={t.refreshTooltip} arrow>
            <span>
              <IconButton size="small" aria-label={t.refresh} disabled={refreshing} onClick={() => void load(true)}>
                <AppIcon icon={RefreshCw} size="sm" />
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Stack>

      {state.kind === 'loading' && <StatsSkeleton />}

      {state.kind === 'error' && (
        <Alert
          severity="error"
          variant="outlined"
          sx={{ py: 0, alignItems: 'center' }}
          action={<Button color="inherit" size="small" onClick={() => void load(false)}>{t.retry}</Button>}
        >
          {state.message}
        </Alert>
      )}

      {state.kind === 'ready' && <StatsBody stats={state.stats} />}
    </Box>
  );
}

function StatsSkeleton() {
  return (
    <Stack spacing={1} data-testid="rotation-stats-loading" aria-busy="true">
      <Stack direction="row" spacing={2}>
        {[0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" height={44} sx={{ flex: 1 }} />)}
      </Stack>
      <Skeleton variant="rounded" height={28} />
    </Stack>
  );
}

function StatsBody({ stats }: { stats: RotationStats }) {
  const lastClick = stats.lastClickAt ? Date.parse(stats.lastClickAt) : NaN;
  const hasLastClick = Number.isFinite(lastClick);
  const lastClickText = hasLastClick ? t.lastClickRelative(lastClick - serverNow()) : t.never;
  const lastClickTitle = hasLastClick ? new Date(lastClick).toLocaleString('pt-BR') : '';

  return (
    <Stack spacing={1.5}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1.5 }}>
        <StatTile label={t.total} value={stats.clickCount.toLocaleString('pt-BR')} />
        <StatTile label={t.last7Days} value={stats.clicksLast7Days.toLocaleString('pt-BR')} />
        <Tooltip title={lastClickTitle} arrow disableHoverListener={!hasLastClick} disableFocusListener={!hasLastClick}>
          <Box sx={{ minWidth: 0 }}>
            <StatTile label={t.lastClick} value={lastClickText} small />
          </Box>
        </Tooltip>
      </Box>

      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{t.perGroup}</Typography>
        {stats.groups.length === 0 ? (
          <Typography variant="body2" color="text.secondary">{t.noGroups}</Typography>
        ) : (
          <Stack component="ul" spacing={1} sx={{ listStyle: 'none', p: 0, m: 0, mt: 0.5 }}>
            {stats.groups.map((g) => <GroupRow key={g.id} group={g} />)}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}

function StatTile({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" noWrap component="div">{label}</Typography>
      <Typography
        variant={small ? 'body2' : 'h6'}
        component="div"
        noWrap
        sx={{ fontWeight: 700, lineHeight: small ? 2 : 1.3, fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </Typography>
    </Box>
  );
}

function GroupRow({ group }: { group: RotationGroupStats }) {
  const blurName = useBlur('linkRotation.groupName');
  const chipColor = STATUS_CHIP[group.status];
  const members = group.memberCount;
  const measured = members !== null && group.capacity > 0;
  const pct = measured ? Math.min(100, Math.round((members / group.capacity) * 100)) : 0;

  return (
    <Box component="li" sx={{ minWidth: 0 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Blurred when={blurName} inline radius={5}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{group.groupName || t.untitledGroup}</Typography>
          </Blurred>
        </Box>
        {chipColor !== undefined && (
          <Tooltip title={linkRotationStrings.groupStatusHelp[group.status]} arrow describeChild>
            <Chip size="small" variant="outlined" color={chipColor} label={linkRotationStrings.groupStatus[group.status]} />
          </Tooltip>
        )}
        <Tooltip title={t.groupClicksTooltip(group.clickCount)} arrow describeChild>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {t.groupClicks7d(group.clicksLast7Days)}
          </Typography>
        </Tooltip>
      </Stack>

      <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.5 }}>
        {measured ? (
          <>
            <Tooltip title={t.occupancyTooltip} arrow describeChild>
              <LinearProgress
                variant="determinate"
                value={pct}
                color={occupancyColor(pct)}
                aria-label={t.occupancyAria(members, group.capacity, pct)}
                sx={{ flex: 1, height: 6, borderRadius: 3, '& .MuiLinearProgress-bar': { borderRadius: 3 } }}
              />
            </Tooltip>
            <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums', minWidth: 72, textAlign: 'right' }}>
              {t.occupancy(members, group.capacity)}
            </Typography>
          </>
        ) : (
          <>
            <Box
              role="img"
              aria-label={t.notMeasuredAria}
              sx={{ flex: 1, height: 6, borderRadius: 3, border: 1, borderStyle: 'dashed', borderColor: 'divider' }}
            />
            <Tooltip title={t.notMeasuredHelp} arrow describeChild>
              <Typography variant="caption" color="text.secondary" tabIndex={0} sx={{ minWidth: 72, textAlign: 'right', cursor: 'help' }}>
                {t.notMeasured}
              </Typography>
            </Tooltip>
          </>
        )}
      </Stack>
    </Box>
  );
}
