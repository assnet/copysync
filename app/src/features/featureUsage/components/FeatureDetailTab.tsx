import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Button, Stack, Typography } from '@mui/material';
import { ArrowLeft, SearchX } from 'lucide-react';
import { AppIcon, EmptyState, ServiceUpdatingState } from '@/components';
import { serverNow } from '@/services/serverClock';
import { DEFAULT_USAGE_FILTERS, featureDescription, featureLabel, withPeriod } from '../rules';
import { featureUsageStrings as S } from '../strings';
import { USAGE_PATH } from '../paths';
import { useUsagePage } from '../hooks/useUsagePage';
import { useUsageDetail } from '../hooks/useUsageDetail';
import { useUsageTenants } from '../hooks/useUsageTenants';
import { FeatureDetail, FeatureDetailSkeleton } from './FeatureDetail';
import { FeatureTenantsTable } from './FeatureTenantsTable';
import { UsageContextLine, UsageRetryAlert } from './UsageSummaryGate';

/**
 * Detalhe de um recurso (`/admin/usage/features/:key`, aba Visão geral marcada). O recurso vem da URL e o dado do
 * servidor pela chave (sobrevive a reload). O resumo da página fica desligado aqui; detalhe, lista de contas e
 * "Carregar mais" passam pela fila do serviço (uma leitura de uso por vez por aba), e a lista só sai depois da
 * resposta do detalhe.
 */
export default function FeatureDetailTab() {
  const { featureKey, query, refreshKey, reportMaxDays, filters, setFilters, maxDays, accountNames } = useUsagePage();
  const key = featureKey ?? '';
  /** Teto que a API recusou no detalhe (400): aviso local até a próxima resposta. */
  const [rangeResetMax, setRangeResetMax] = useState<number | null>(null);

  const detail = useUsageDetail(key, query, {
    refreshKey,
    reportMaxDays,
    onRangeInvalid: () => {
      setRangeResetMax(maxDays);
      setFilters(withPeriod(filters, { preset: DEFAULT_USAGE_FILTERS.preset }, serverNow()));
    },
  });
  const ready = detail.loading ? null : detail.data;
  const tenants = useUsageTenants(key, query, ready);

  // A lista registra os nomes carregados (só em memória) para o chip da conta filtrada.
  const { remember } = accountNames;
  useEffect(() => {
    remember(tenants.rows);
  }, [tenants.rows, remember]);

  const back = (
    <Button component={RouterLink} to={USAGE_PATH} startIcon={<AppIcon icon={ArrowLeft} size="sm" aria-hidden />} sx={{ minHeight: 44 }}>
      {S.actions.back}
    </Button>
  );

  if (detail.notFound) {
    return (
      <EmptyState
        icon={<AppIcon icon={SearchX} size="lg" aria-hidden />}
        title={S.detail.notFoundTitle}
        description={S.detail.notFoundDescription}
        action={back}
      />
    );
  }

  let body;
  if (detail.unavailable && !detail.data) body = <ServiceUpdatingState onRetry={detail.reload} />;
  else if ((detail.error || detail.slow) && !detail.data && !detail.loading) {
    body = <UsageRetryAlert slow={detail.slow} onRetry={detail.reload} message={S.errors.detailFailed} />;
  } else if (!detail.data) body = <FeatureDetailSkeleton />;
  else {
    body = (
      <Stack spacing={2} aria-busy={detail.loading}>
        <UsageContextLine features={[detail.data.feature]} freshAt={detail.data.freshAt} />
        <FeatureDetail detail={detail.data} />
        <FeatureTenantsTable
          q={tenants}
          filteredTenantId={filters.tenantId}
          onFilter={(tenantId) => setFilters({ ...filters, tenantId })}
        />
      </Stack>
    );
  }

  return (
    <Stack spacing={2} aria-label={S.detail.aria(featureLabel(key))} component="section">
      <div>{back}</div>
      <div>
        <Typography variant="h6" component="h2">{S.detail.title(featureLabel(key))}</Typography>
        {featureDescription(key) && (
          <Typography variant="body2" color="text.secondary">{featureDescription(key)}</Typography>
        )}
      </div>
      {rangeResetMax !== null && <Alert severity="info" onClose={() => setRangeResetMax(null)}>{S.rangeReset(rangeResetMax)}</Alert>}
      {body}
    </Stack>
  );
}
