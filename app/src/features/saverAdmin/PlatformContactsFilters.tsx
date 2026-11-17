import { Eraser, Search } from 'lucide-react';
import { Box, Button, InputAdornment, MenuItem, TextField, Tooltip } from '@mui/material';
import { AppIcon } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { saverAdminStrings as s } from './strings';
import { EMPTY_PLATFORM_FILTERS, type PlatformContactFilters } from './types';
import { PlatformPhoneFilters } from './PlatformPhoneFilters';
import { usePlatformTenants } from './usePlatformTenants';

interface Props {
  value: PlatformContactFilters;
  onChange: (next: PlatformContactFilters) => void;
  periodInvalid: boolean;
}

/** Valores de ação no menu do seletor (não são contas). */
const MORE = '__more__';
const RETRY = '__retry__';

/**
 * Busca, conta, país (DDI), DDD e período. As contas do seletor vêm da API (só as com vínculo na base, página do servidor
 * por cursor, ordem por nome); conta escolhida fora das páginas carregadas aparece pelo id curto.
 */
export function PlatformContactsFilters({ value, onChange, periodInvalid }: Props) {
  const { tenants: options, hasMore, loading, failed, loadMore, reload } = usePlatformTenants();
  const blurTenant = useBlur('saverAdmin.tenantNames');
  const set = (patch: Partial<PlatformContactFilters>) => onChange({ ...value, ...patch });
  const dirty = JSON.stringify(value) !== JSON.stringify(EMPTY_PLATFORM_FILTERS);
  const tenantLabel = (id: string) => options.find((t) => t.id === id)?.name ?? s.detail.unknownTenant(id);
  const pickTenant = (v: string) => {
    if (v === MORE) return loadMore();
    if (v === RETRY) return reload();
    set({ tenantId: v });
  };

  return (
    <Box
      role="search"
      aria-label={s.filters.label}
      sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' }, alignItems: 'start' }}
    >
      <TextField
        size="small"
        label={s.filters.search}
        placeholder={s.filters.searchPlaceholder}
        value={value.search}
        onChange={(e) => set({ search: e.target.value.slice(0, 100) })}
        InputProps={{ startAdornment: <InputAdornment position="start"><AppIcon icon={Search} size="sm" /></InputAdornment> }}
        sx={{ gridColumn: { sm: '1 / -1', lg: 'span 2' } }}
      />
      <Tooltip title={s.filters.tenantHint} arrow placement="top">
        <TextField
          select
          size="small"
          label={s.filters.tenant}
          value={value.tenantId}
          onChange={(e) => pickTenant(e.target.value)}
          SelectProps={{
            displayEmpty: true,
            renderValue: (v) => (v ? <Blurred when={blurTenant} inline>{tenantLabel(String(v))}</Blurred> : s.filters.allTenants),
          }}
          InputLabelProps={{ shrink: true }}
        >
          <MenuItem value="">{s.filters.allTenants}</MenuItem>
          {options.map((t) => (
            <MenuItem key={t.id} value={t.id}><Blurred when={blurTenant} inline>{t.name}</Blurred></MenuItem>
          ))}
          {loading && <MenuItem disabled value="__loading__">{s.filters.tenantsLoading}</MenuItem>}
          {!loading && failed && <MenuItem value={RETRY} sx={{ color: 'error.main' }}>{s.filters.tenantsError}</MenuItem>}
          {!loading && !failed && hasMore && <MenuItem value={MORE} sx={{ color: 'primary.main' }}>{s.filters.tenantsMore}</MenuItem>}
        </TextField>
      </Tooltip>
      <PlatformPhoneFilters ddi={value.ddi} ddd={value.ddd} onChange={(phone) => set(phone)} />
      <TextField
        size="small"
        type="date"
        label={s.filters.from}
        value={value.from}
        onChange={(e) => set({ from: e.target.value })}
        InputLabelProps={{ shrink: true }}
        inputProps={{ max: value.to || undefined }}
        error={periodInvalid}
        helperText={periodInvalid ? s.filters.invalidPeriod : undefined}
      />
      <TextField
        size="small"
        type="date"
        label={s.filters.to}
        value={value.to}
        onChange={(e) => set({ to: e.target.value })}
        InputLabelProps={{ shrink: true }}
        inputProps={{ min: value.from || undefined }}
        error={periodInvalid}
      />
      <Button
        variant="text"
        color="inherit"
        disabled={!dirty}
        onClick={() => onChange(EMPTY_PLATFORM_FILTERS)}
        startIcon={<AppIcon icon={Eraser} size="inline" />}
        sx={{ minHeight: 40, whiteSpace: 'nowrap', justifySelf: { xs: 'stretch', sm: 'start' }, gridColumn: { sm: '1 / -1', lg: 'auto' } }}
      >
        {s.filters.clear}
      </Button>
    </Box>
  );
}
