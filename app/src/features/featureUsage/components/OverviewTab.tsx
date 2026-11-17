import { Stack } from '@mui/material';
import { clearUsageFilters } from '../rules';
import { useUsagePage } from '../hooks/useUsagePage';
import { UsageKpiRow } from './UsageKpiRow';
import { UsageSummaryGate } from './UsageSummaryGate';

/**
 * Aba Visão geral (`/admin/usage`): indicadores do período. Ranking, tendência e "sem uso no período" entram aqui,
 * abaixo dos indicadores, sem tocar na página.
 */
export default function OverviewTab() {
  const { filters, setFilters } = useUsagePage();
  return (
    <UsageSummaryGate onClearFilters={() => setFilters(clearUsageFilters(filters))}>
      {(summary) => (
        <Stack spacing={2}>
          <UsageKpiRow summary={summary} />
        </Stack>
      )}
    </UsageSummaryGate>
  );
}
