import { MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { serverNow } from '@/services/serverClock';
import { PLAN_CATALOG, type PlanSlug } from '@/features/plans/catalog';
import { HelpTip } from '@/features/opsMetrics/components/HelpTip';
import { catalogPlanName, costMonthOptions, monthLabel } from '../rules';
import { infraCostsStrings as S } from '../strings';
import type { CostFilters, InfraCostSplitBasis } from '../types';

const CURRENT_MONTH = 'current';

interface Props {
  filters: CostFilters;
  onChange: (f: CostFilters) => void;
  aria: string;
  /** Base do rateio (contratadas × conectadas): só no Resumo. */
  showBasis?: boolean;
}

/**
 * Filtros das abas de custos (mês, base do rateio, plano). O estado é o mesmo `costs.filters` (escopo `tab`) em
 * todas as abas: trocar de aba mantém o mês e o plano escolhidos.
 */
export function CostFiltersBar({ filters, onChange, aria, showBasis = true }: Props) {
  const f = S.summary.filters;
  // Relógio do servidor (header `X-Server-Time`): o mês corrente é o da API, não o do navegador.
  const [current, ...past] = costMonthOptions(serverNow());
  const months = filters.month && filters.month !== current && !past.includes(filters.month) ? [...past, filters.month] : past;
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, flexWrap: 'wrap', rowGap: 2 }} role="group" aria-label={aria}>
      <TextField
        select
        size="small"
        label={f.month}
        value={filters.month && filters.month !== current ? filters.month : CURRENT_MONTH}
        onChange={(e) => onChange({ ...filters, month: e.target.value === CURRENT_MONTH ? null : e.target.value })}
        sx={{ minWidth: 200 }}
      >
        <MenuItem value={CURRENT_MONTH}>{f.currentMonth(monthLabel(current))}</MenuItem>
        {months.map((m) => <MenuItem key={m} value={m}>{monthLabel(m)}</MenuItem>)}
      </TextField>
      {showBasis && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <ToggleButtonGroup
            exclusive
            color="primary"
            size="small"
            value={filters.basis}
            aria-label={f.basis}
            onChange={(_, v: InfraCostSplitBasis | null) => v && onChange({ ...filters, basis: v })}
          >
            <ToggleButton value="contracted">{f.contracted}</ToggleButton>
            <ToggleButton value="connected">{f.connected}</ToggleButton>
          </ToggleButtonGroup>
          <HelpTip label={f.basis} text={f.basisHint} />
        </Stack>
      )}
      <TextField
        select
        size="small"
        label={f.plan}
        value={filters.plan}
        onChange={(e) => onChange({ ...filters, plan: e.target.value as PlanSlug | 'all' })}
        sx={{ minWidth: 200 }}
      >
        <MenuItem value="all">{f.allPlans}</MenuItem>
        {PLAN_CATALOG.map((p) => <MenuItem key={p.slug} value={p.slug}>{catalogPlanName(p.slug)}</MenuItem>)}
      </TextField>
    </Stack>
  );
}
