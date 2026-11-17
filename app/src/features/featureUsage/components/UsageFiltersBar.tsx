import { useState } from 'react';
import {
  Box, Button, Chip, Drawer, FormControlLabel, IconButton, ListSubheader, MenuItem, Stack, Switch, TextField,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import { Building2, SlidersHorizontal, X } from 'lucide-react';
import { AppIcon } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import { serverNow } from '@/services/serverClock';
import { HelpTip } from '@/features/opsMetrics/components/HelpTip';
import { useBlur } from '@/features/privacy/PrivacyContext';
import {
  accountChipLabel, activeFiltersCount, clearUsageFilters, coerceGranularity, granularityOptions, kindLabel, planLabel, presetsWithin,
  productLabel, rangeErrorText, resolvePeriod, toggleKind, USAGE_DAY_GRANULARITY_MAX_DAYS, USAGE_FAMILY_PLANS, USAGE_KINDS, USAGE_PLAN_FAMILIES,
  USAGE_PRODUCTS, USAGE_TENANT_STATUSES, validateCustomRange, withPeriod, type UsageRangeError,
} from '../rules';
import { featureUsageStrings as S } from '../strings';
import { BlurredAccountName } from './BlurredAccountName';
import type { UsageFilters, UsageGranularity, UsageKind, UsagePeriodPreset, UsagePlan, UsageProduct, UsageTenantStatusFilter } from '../types';

const f = S.filters;

export interface UsageFiltersBarProps {
  filters: UsageFilters;
  onChange: (next: UsageFilters) => void;
  /** Teto do período em vigor (`range.maxDays`). */
  maxDays: number;
  /** Nome da conta filtrada, se já carregado pela lista do detalhe (só em memória). */
  accountName?: string;
}

interface CustomDraft { from: string; to: string }

function PeriodControl({ filters, onChange, maxDays }: Omit<UsageFiltersBarProps, 'accountName'>) {
  const [draft, setDraft] = usePersistedState<CustomDraft>('usage.customDraft', {
    from: filters.from ?? '', to: filters.to ?? '',
  }, { scope: 'tab' });
  /**
   * Preset em vigor quando "Personalizado" foi aberto sem aplicar. Derivado do preset: se ele muda (outro botão,
   * "Limpar filtros", volta aos 30 dias após 400), o modo personalizado fecha sozinho.
   */
  const [customOpenFor, setCustomOpenFor] = useState<UsagePeriodPreset | null>(null);
  const [error, setError] = useState<UsageRangeError | null>(null);
  const showCustom = filters.preset === 'custom' || customOpenFor === filters.preset;

  const choose = (preset: UsagePeriodPreset | null) => {
    if (!preset) return;
    if (preset === 'custom') {
      setCustomOpenFor(filters.preset);
      return;
    }
    setCustomOpenFor(null);
    setError(null);
    onChange(withPeriod(filters, { preset }, serverNow()));
  };

  const apply = () => {
    const now = serverNow();
    const problem = validateCustomRange(draft.from, draft.to, maxDays, now);
    setError(problem);
    if (problem) return;
    onChange(withPeriod(filters, { preset: 'custom', from: draft.from, to: draft.to }, now));
  };

  return (
    <Stack spacing={1} sx={{ minWidth: 0 }}>
      <ToggleButtonGroup
        exclusive
        size="small"
        color="primary"
        value={showCustom ? 'custom' : filters.preset}
        onChange={(_, v: UsagePeriodPreset | null) => choose(v)}
        aria-label={f.period}
        sx={{ flexWrap: 'wrap' }}
      >
        {presetsWithin(maxDays).map((p) => (
          <ToggleButton key={p} value={p} sx={{ minHeight: 40, px: 1.5 }}>{f.presets[p]}</ToggleButton>
        ))}
      </ToggleButtonGroup>
      {showCustom && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
          <TextField
            type="date"
            size="small"
            label={f.customFrom}
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            slotProps={{ inputLabel: { shrink: true } }}
            error={error !== null}
          />
          <TextField
            type="date"
            size="small"
            label={f.customTo}
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            slotProps={{ inputLabel: { shrink: true } }}
            error={error !== null}
            helperText={error ? rangeErrorText(error, maxDays) : f.customHint(maxDays)}
          />
          <Button variant="outlined" onClick={apply} sx={{ minHeight: 40, whiteSpace: 'nowrap' }}>{f.customApply}</Button>
        </Stack>
      )}
    </Stack>
  );
}

function GranularityControl({ filters, onChange }: Pick<UsageFiltersBarProps, 'filters' | 'onChange'>) {
  const { days } = resolvePeriod(filters, serverNow());
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <ToggleButtonGroup
        exclusive
        size="small"
        color="primary"
        value={coerceGranularity(filters.granularity, days)}
        onChange={(_, v: UsageGranularity | null) => v && onChange({ ...filters, granularity: v })}
        aria-label={f.granularity}
      >
        {granularityOptions(days).map((o) => {
          const button = (
            <ToggleButton key={o.value} value={o.value} disabled={o.disabled} sx={{ minHeight: 40, px: 1.5 }}>
              {f.granularities[o.value]}
            </ToggleButton>
          );
          // Botão desabilitado não dispara eventos: o Tooltip fica num `span` em volta.
          return o.disabled ? (
            <Tooltip key={o.value} title={o.reason === 'singleDay' ? f.singleDayHint : f.dayDisabledHint(USAGE_DAY_GRANULARITY_MAX_DAYS)} enterTouchDelay={0}>
              <span>{button}</span>
            </Tooltip>
          ) : button;
        })}
      </ToggleButtonGroup>
    </Stack>
  );
}

function SelectControls({ filters, onChange }: Pick<UsageFiltersBarProps, 'filters' | 'onChange'>) {
  const selectSx = { minWidth: { xs: '100%', sm: 180 } } as const;
  return (
    <>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <TextField
          select
          size="small"
          label={f.product}
          value={filters.product}
          onChange={(e) => onChange({ ...filters, product: e.target.value as UsageProduct | 'all' })}
          sx={selectSx}
        >
          <MenuItem value="all">{f.allProducts}</MenuItem>
          {USAGE_PRODUCTS.map((p) => <MenuItem key={p} value={p}>{productLabel(p)}</MenuItem>)}
        </TextField>
      </Stack>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <TextField
          select
          size="small"
          label={f.kind}
          value={filters.kinds}
          onChange={(e) => {
            const picked = e.target.value as unknown as UsageKind[];
            const changed = USAGE_KINDS.find((k) => picked.includes(k) !== filters.kinds.includes(k));
            if (changed) onChange({ ...filters, kinds: toggleKind(filters.kinds, changed) });
          }}
          slotProps={{
            select: {
              multiple: true,
              renderValue: (v) => {
                const list = v as UsageKind[];
                return list.length === USAGE_KINDS.length ? f.allKinds : list.map(kindLabel).join(', ');
              },
            },
          }}
          sx={selectSx}
        >
          {USAGE_KINDS.map((k) => (
            <MenuItem key={k} value={k} selected={filters.kinds.includes(k)}>
              <Switch size="small" checked={filters.kinds.includes(k)} tabIndex={-1} inputProps={{ 'aria-hidden': true }} sx={{ mr: 1 }} />
              <Tooltip title={S.kindHints[k]} placement="right" enterDelay={400}>
                <span>{kindLabel(k)}</span>
              </Tooltip>
            </MenuItem>
          ))}
        </TextField>
        <HelpTip label={f.kind} text={f.kindHint} />
      </Stack>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <TextField
          select
          size="small"
          label={f.plan}
          value={filters.plan}
          onChange={(e) => onChange({ ...filters, plan: e.target.value as UsagePlan | 'all' })}
          sx={selectSx}
        >
          <MenuItem value="all">{f.allPlans}</MenuItem>
          {USAGE_PLAN_FAMILIES.flatMap((family) => [
            <ListSubheader key={`h-${family}`}>{f.planGroup(S.planFamilies[family])}</ListSubheader>,
            ...USAGE_FAMILY_PLANS[family].map((p) => <MenuItem key={p} value={p}>{planLabel(p)}</MenuItem>),
          ])}
          <MenuItem value="NONE">{planLabel('NONE')}</MenuItem>
        </TextField>
        <HelpTip label={f.plan} text={f.planHint} />
      </Stack>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <TextField
          select
          size="small"
          label={f.status}
          value={filters.tenantStatus}
          onChange={(e) => onChange({ ...filters, tenantStatus: e.target.value as UsageTenantStatusFilter })}
          sx={selectSx}
        >
          {USAGE_TENANT_STATUSES.map((st) => <MenuItem key={st} value={st}>{f.statusOptions[st]}</MenuItem>)}
        </TextField>
        <HelpTip label={f.status} text={f.statusHint} />
      </Stack>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <FormControlLabel
          control={<Switch checked={filters.includeInternal} onChange={(e) => onChange({ ...filters, includeInternal: e.target.checked })} />}
          label={f.includeInternal}
          sx={{ mr: 0 }}
        />
        <HelpTip label={f.includeInternal} text={f.includeInternalHint} />
      </Stack>
    </>
  );
}

/**
 * Chip removível da conta filtrada: nome já carregado ou id curto, sob `Blurred`. Com a flag ligada o chip se anuncia
 * pelo id curto (`aria-label`) e o nome fica fora da árvore acessível.
 */
export function AccountChip({ tenantId, name, onRemove }: { tenantId: string; name?: string; onRemove: () => void }) {
  const blur = useBlur('usage.tenantName');
  return (
    <Tooltip title={f.accountHint}>
      <Chip
        icon={<AppIcon icon={Building2} size="sm" aria-hidden />}
        aria-label={blur ? f.accountShort(tenantId) : undefined}
        label={<BlurredAccountName blur={blur} tenantId={tenantId} name={accountChipLabel(tenantId, name)} />}
        onDelete={onRemove}
        deleteIcon={<AppIcon icon={X} size="sm" aria-label={f.removeAccount} role="button" />}
        variant="outlined"
        color="primary"
        sx={{ maxWidth: '100%', minHeight: 32 }}
      />
    </Tooltip>
  );
}

/**
 * Filtros da tela de uso: período (preset ou personalizado), agrupamento, produto, tipo, plano, status, internas e
 * conta. No celular os controles ficam numa gaveta ("Filtros (n)"). Toda mudança vale na hora.
 */
export function UsageFiltersBar({ filters, onChange, maxDays, accountName }: UsageFiltersBarProps) {
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });
  const [open, setOpen] = useState(false);
  const count = activeFiltersCount(filters);
  const chip = filters.tenantId ? (
    <AccountChip tenantId={filters.tenantId} name={accountName} onRemove={() => onChange({ ...filters, tenantId: null })} />
  ) : null;

  if (compact) {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }} role="group" aria-label={f.aria}>
        <Button
          variant="outlined"
          startIcon={<AppIcon icon={SlidersHorizontal} size="sm" aria-hidden />}
          onClick={() => setOpen(true)}
          sx={{ minHeight: 44 }}
        >
          {f.openWithCount(count)}
        </Button>
        {chip}
        <Drawer
          anchor="bottom"
          open={open}
          onClose={() => setOpen(false)}
          slotProps={{ paper: { sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '90dvh' } } }}
        >
          <Box sx={{ p: 2, pb: 3 }} role="dialog" aria-label={f.drawerTitle}>
            <Stack direction="row" sx={{ alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" component="h2" sx={{ flex: 1 }}>{f.drawerTitle}</Typography>
              <Tooltip title={f.close}>
                <IconButton aria-label={f.close} onClick={() => setOpen(false)} sx={{ width: 44, height: 44 }}>
                  <AppIcon icon={X} size="md" />
                </IconButton>
              </Tooltip>
            </Stack>
            <Stack spacing={2}>
              <PeriodControl filters={filters} onChange={onChange} maxDays={maxDays} />
              <GranularityControl filters={filters} onChange={onChange} />
              <SelectControls filters={filters} onChange={onChange} />
            </Stack>
            <Stack direction="row" spacing={1} sx={{ mt: 3, justifyContent: 'flex-end' }}>
              <Button onClick={() => onChange(clearUsageFilters(filters))} sx={{ minHeight: 44 }}>{f.reset}</Button>
              <Button variant="contained" onClick={() => setOpen(false)} sx={{ minHeight: 44 }}>{f.apply}</Button>
            </Stack>
          </Box>
        </Drawer>
      </Stack>
    );
  }

  return (
    <Stack spacing={1.5} role="group" aria-label={f.aria}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', flexWrap: 'wrap', rowGap: 1.5 }}>
        <PeriodControl filters={filters} onChange={onChange} maxDays={maxDays} />
        <GranularityControl filters={filters} onChange={onChange} />
      </Stack>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1.5 }}>
        <SelectControls filters={filters} onChange={onChange} />
        {chip}
      </Stack>
    </Stack>
  );
}
