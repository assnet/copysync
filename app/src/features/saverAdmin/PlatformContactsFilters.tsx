import { useMemo } from 'react';
import { Eraser, Search } from 'lucide-react';
import { Box, Button, InputAdornment, MenuItem, TextField, Tooltip } from '@mui/material';
import { AppIcon } from '@/components';
import { useTenant } from '@/contexts/TenantContext';
import { Blurred, useBlur } from '@/features/privacy';
import { saverAdminStrings as s } from './strings';
import { EMPTY_PLATFORM_FILTERS, type PlatformContactFilters } from './types';

interface Props {
  value: PlatformContactFilters;
  onChange: (next: PlatformContactFilters) => void;
  periodInvalid: boolean;
}

/** Busca, conta e período. As contas do seletor são as que o usuário enxerga (`GET /tenants`). */
export function PlatformContactsFilters({ value, onChange, periodInvalid }: Props) {
  const { tenants } = useTenant();
  const blurTenant = useBlur('saverAdmin.tenantNames');
  const options = useMemo(() => [...tenants].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), [tenants]);
  const set = (patch: Partial<PlatformContactFilters>) => onChange({ ...value, ...patch });
  const dirty = JSON.stringify(value) !== JSON.stringify(EMPTY_PLATFORM_FILTERS);
  const tenantLabel = (id: string) => options.find((t) => t.id === id)?.name ?? id;

  return (
    <Box
      role="search"
      aria-label={s.filters.label}
      sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '2fr 1.4fr 1fr 1fr auto' }, alignItems: 'start' }}
    >
      <TextField
        size="small"
        label={s.filters.search}
        placeholder={s.filters.searchPlaceholder}
        value={value.search}
        onChange={(e) => set({ search: e.target.value.slice(0, 100) })}
        InputProps={{ startAdornment: <InputAdornment position="start"><AppIcon icon={Search} size="sm" /></InputAdornment> }}
      />
      <Tooltip title={s.filters.tenantHint} arrow placement="top">
        <TextField
          select
          size="small"
          label={s.filters.tenant}
          value={value.tenantId}
          onChange={(e) => set({ tenantId: e.target.value })}
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
        </TextField>
      </Tooltip>
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
        sx={{ minHeight: 40, whiteSpace: 'nowrap' }}
      >
        {s.filters.clear}
      </Button>
    </Box>
  );
}
