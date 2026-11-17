import { Stack } from '@mui/material';
import { usePersistedState } from '@/hooks/usePersistedState';
import { clearUsageFilters, familiesInSummary, USAGE_PLAN_FAMILIES } from '../rules';
import { useUsagePage } from '../hooks/useUsagePage';
import type { UsagePlanFamily } from '../types';
import { PlanMatrixTable } from './PlanMatrixTable';
import { summaryFeatures, UsageSummaryGate } from './UsageSummaryGate';

/** Família escolhida na aba (escopo `tab`); ignorada quando não tem recurso no recorte. */
export const USAGE_PLANS_FAMILY_KEY = 'usage.plans.family';

const parseFamily = (raw: unknown): UsagePlanFamily =>
  (USAGE_PLAN_FAMILIES as unknown[]).includes(raw) ? (raw as UsagePlanFamily) : 'AFFILIATES';

/**
 * Aba Por plano (`/admin/usage/plans`): lê o mesmo resumo da Visão geral (sem leitura própria) e mostra a matriz
 * recurso × plano de uma família por vez.
 */
export default function PlansTab() {
  const { filters, setFilters } = useUsagePage();
  const [saved, setSaved] = usePersistedState<UsagePlanFamily>(USAGE_PLANS_FAMILY_KEY, 'AFFILIATES', {
    deserialize: parseFamily,
  });
  return (
    <UsageSummaryGate onClearFilters={() => setFilters(clearUsageFilters(filters))}>
      {(summary) => {
        const features = summaryFeatures(summary, filters);
        const families = familiesInSummary(features);
        const family = families.includes(saved) ? saved : (families[0] ?? saved);
        return (
          <Stack spacing={2}>
            <PlanMatrixTable
              summary={{ population: summary.population, features }}
              families={families}
              family={family}
              onFamilyChange={setSaved}
              sort={filters.sort}
            />
          </Stack>
        );
      }}
    </UsageSummaryGate>
  );
}
