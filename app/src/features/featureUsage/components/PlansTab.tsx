import { Stack } from '@mui/material';
import { clearUsageFilters } from '../rules';
import { useUsagePage } from '../hooks/useUsagePage';
import { UsageSummaryGate } from './UsageSummaryGate';

/**
 * Aba Por plano (`/admin/usage/plans`): lê o mesmo resumo da Visão geral (sem leitura própria). A tabela
 * recurso × plano entra aqui, sem tocar na página.
 */
export default function PlansTab() {
  const { filters, setFilters } = useUsagePage();
  return (
    <UsageSummaryGate onClearFilters={() => setFilters(clearUsageFilters(filters))}>
      {() => <Stack spacing={2} />}
    </UsageSummaryGate>
  );
}
