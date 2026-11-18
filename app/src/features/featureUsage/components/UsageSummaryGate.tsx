import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Box, Button, Chip, Skeleton, Stack, Tooltip, Typography } from '@mui/material';
import { ChartColumn, Info, Radio, TriangleAlert } from 'lucide-react';
import { serverNow } from '@/services/serverClock';
import { AppIcon, EmptyState, ServiceUpdatingState } from '@/components';
import {
  contextLine, earliestFirstDataDay, minutesSince, presetDays, sourceState, USAGE_INITIAL_MAX_DAYS, visibleFeatures, withPeriod,
} from '../rules';
import { featureUsageStrings as S } from '../strings';
import type { UsageFeatureItem, UsageFilters, UsageLiveReason, UsageSource, UsageSummary } from '../types';
import { useUsagePage } from '../hooks/useUsagePage';
import { UsageKpiRowSkeleton } from './UsageKpiRow';

/** Intervalo do relógio da linha de contexto (aviso de dado antigo). */
export const CONTEXT_CLOCK_MS = 60_000;

/**
 * "Dias no horário de Brasília · dados desde 26/10/2026 · atualizado às 15:02" (menor `firstDataDay` visível), com a
 * fonte: leitura sob demanda (`live`) ganha um chip discreto; agregado diário sem atualizar há mais de 1 h, um aviso.
 */
export function UsageContextLine({ features, freshAt, source, liveReason = null }: {
  features: readonly Pick<UsageFeatureItem, 'firstDataDay'>[]; freshAt: string; source: UsageSource;
  /** Por que leu direto (`null` = motivo não informado: só o que a leitura significa). */
  liveReason?: UsageLiveReason | null;
}) {
  // Relógio reativo: o aviso de dado antigo aparece (e a idade avança) sem esperar outra renderização.
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    setNow(serverNow());
    const timer = window.setInterval(() => setNow(serverNow()), CONTEXT_CLOCK_MS);
    return () => window.clearInterval(timer);
  }, [freshAt]);
  const state = sourceState({ source, freshAt }, now);
  const liveTip = S.context.liveTooltip(liveReason ? S.context.liveReasons[liveReason] : null);
  return (
    <Stack spacing={0.5} aria-label={S.context.aria} role="group">
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
        <Typography variant="caption" color="text.secondary" component="p">
          {contextLine({ firstDataDay: earliestFirstDataDay(features), freshAt })}
        </Typography>
        {state === 'live' ? (
          <Tooltip title={liveTip} enterTouchDelay={0}>
            <Chip
              size="small"
              variant="outlined"
              tabIndex={0}
              icon={<AppIcon icon={Radio} size="inline" aria-hidden />}
              label={S.context.liveBadge}
              aria-label={`${S.context.liveBadge}. ${liveTip}`}
              sx={{ height: 22, color: 'text.secondary', '& .MuiChip-label': { px: 0.75, fontSize: 11, fontWeight: 600 } }}
            />
          </Tooltip>
        ) : (
          <Tooltip title={S.context.dailyHint} enterTouchDelay={0}>
            <Box component="span" tabIndex={0} aria-label={S.context.dailyHint} sx={{ display: 'inline-flex', color: 'text.secondary' }}>
              <AppIcon icon={Info} size="sm" aria-hidden />
            </Box>
          </Tooltip>
        )}
      </Stack>
      {state === 'stale' && (
        <Typography
          variant="caption"
          component="p"
          role="status"
          color="text.primary"
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
        >
          {/* Só o ícone no tom de aviso: o âmbar do tema não tem contraste de texto no claro. */}
          <Box component="span" sx={{ display: 'inline-flex', color: (t) => (t.palette.mode === 'light' ? t.palette.warning.dark : t.palette.warning.main) }}>
            <AppIcon icon={TriangleAlert} size="inline" aria-hidden />
          </Box>
          {S.context.stale(S.context.age(minutesSince(freshAt, now)))}
        </Typography>
      )}
    </Stack>
  );
}

/**
 * Erro e leitura lenta: `Alert` com "Tentar de novo" (o 503 `USAGE_METRICS_READ_UNAVAILABLE` tem texto próprio).
 * `stale`: há dado anterior na tela, mostrado abaixo do aviso e marcado como desatualizado.
 * `onUseShortPeriod`: 503 com período acima de 90 dias (resumo diário parado): texto próprio e ação "Usar 90 dias".
 */
export function UsageRetryAlert({ slow, onRetry, message, stale = false, onUseShortPeriod }: {
  slow: boolean; onRetry: () => void; message?: string; stale?: boolean; onUseShortPeriod?: () => void;
}) {
  const longPeriod = slow && onUseShortPeriod !== undefined;
  const text = longPeriod ? S.errors.readSlowLongPeriod
    : stale ? (slow ? S.errors.staleSlow : S.errors.staleFailed) : slow ? S.errors.readSlow : message ?? S.errors.loadFailed;
  const button = { whiteSpace: 'nowrap' } as const;
  return (
    <Alert
      severity={slow ? 'warning' : 'error'}
      action={(
        <Stack direction="row" spacing={0.5}>
          {longPeriod && <Button color="inherit" size="small" sx={button} onClick={onUseShortPeriod}>{S.errors.useShortPeriod}</Button>}
          <Button color="inherit" size="small" sx={button} onClick={onRetry}>{S.actions.retry}</Button>
        </Stack>
      )}
    >
      {text}
    </Alert>
  );
}

/** Recursos do resumo que valem para os filtros da tela (defesa: a API já recorta). */
export function summaryFeatures(summary: UsageSummary, filters: UsageFilters): UsageFeatureItem[] {
  return visibleFeatures(summary.features, filters);
}

/**
 * Estados comuns das abas que leem o resumo: serviço atualizando, erro/leitura lenta, carregando (esqueleto no
 * formato dos blocos), vazio (com "Limpar filtros") e, com dado, linha de contexto + `children(resumo)`.
 */
export function UsageSummaryGate({
  children,
  onClearFilters,
}: {
  children: (summary: UsageSummary) => ReactNode;
  onClearFilters: () => void;
}) {
  const { summary: q, filters, setFilters } = useUsagePage();
  const { data } = q;
  // 503 com período acima de 90 dias: só o resumo diário cobre; parado, oferece voltar a 90 dias.
  const longPeriod = (presetDays(filters.preset, filters.from, filters.to) ?? 0) > USAGE_INITIAL_MAX_DAYS;
  const useShortPeriod = longPeriod ? () => setFilters(withPeriod(filters, { preset: '90d' }, serverNow())) : undefined;

  if (q.unavailable && !data) return <ServiceUpdatingState onRetry={q.reload} />;
  if ((q.error || q.slow) && !data && !q.loading) {
    return <UsageRetryAlert slow={q.slow} onRetry={q.reload} onUseShortPeriod={useShortPeriod} />;
  }
  if (!data) {
    return (
      <Stack spacing={2} role="status" aria-label={S.states.loading}>
        <Skeleton variant="text" width={320} />
        <UsageKpiRowSkeleton />
        <Skeleton variant="rounded" height={320} />
      </Stack>
    );
  }

  const features = summaryFeatures(data, filters);
  const empty = features.length === 0 || data.totals.activeTenants === 0;
  // Falha ao atualizar com dado anterior na tela: aviso acima, nunca some em silêncio.
  const stale = (q.error || q.slow) && !q.loading;
  return (
    <Stack spacing={2} aria-busy={q.loading}>
      {stale && <UsageRetryAlert slow={q.slow} onRetry={q.reload} stale onUseShortPeriod={useShortPeriod} />}
      <UsageContextLine features={features} freshAt={data.freshAt} source={data.source} liveReason={data.liveReason} />
      {empty ? (
        <EmptyState
          icon={<AppIcon icon={ChartColumn} size="lg" aria-hidden />}
          title={S.states.emptyTitle}
          description={S.states.emptyDescription}
          action={<Button variant="outlined" onClick={onClearFilters}>{S.actions.clearFilters}</Button>}
        />
      ) : children(data)}
    </Stack>
  );
}
