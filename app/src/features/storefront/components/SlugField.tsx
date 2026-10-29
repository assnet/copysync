import { useId } from 'react';
import {
  Box, Chip, CircularProgress, FormHelperText, InputAdornment, MenuItem, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import { CircleCheck, CircleX, Globe, Sparkles, TriangleAlert, type LucideIcon } from 'lucide-react';
import { AppIcon } from '@/components';
import { useBlur } from '@/features/privacy';
import { normalizeSlugInput } from '@/features/linkRotation/slug';
import { slugStatusView, type SlugStatusTone } from '../storefrontForm';
import { storefrontStrings } from '../strings';
import type { SlugAvailabilityStatus, StorefrontDomain } from '../types';
import { STOREFRONT_RANGES } from '../types';

const t = storefrontStrings.fields.subdomain;

const TONE_ICON: Record<SlugStatusTone, LucideIcon> = {
  success: CircleCheck,
  info: CircleCheck,
  warning: TriangleAlert,
  error: CircleX,
};

export interface SlugFieldProps {
  /** Nome como digitado (normalizado a cada tecla; `finalizeSlug` corta o hífen do fim ao salvar). */
  value: string;
  onChange: (slug: string) => void;
  domainId: string;
  domains: StorefrontDomain[];
  onDomainChange: (domainId: string) => void;
  /** Último resultado do `slug-availability`; null = ainda não checado. */
  status: SlugAvailabilityStatus | null;
  /** Checagem em andamento (a página faz o debounce e a chamada). */
  checking: boolean;
  /** Nomes livres sugeridos pela API; clicar troca o valor. */
  suggestions: string[];
  /** Erro local do formulário (`validateForm`), mostrado no lugar do status. */
  error?: string;
  disabled?: boolean;
}

/** Nome do endereço público: campo + sufixo `.hostname`, domínio (se >1), estado e sugestões. */
export function SlugField({
  value, onChange, domainId, domains, onDomainChange, status, checking, suggestions, error, disabled,
}: SlugFieldProps) {
  const uid = useId();
  const ids = { status: `${uid}-status`, rule: `${uid}-rule`, suggestions: `${uid}-suggestions` };
  const blur = useBlur('storefront.subdomain');
  const hostname = domains.find((d) => d.id === domainId)?.hostname ?? domains[0]?.hostname ?? '';
  const view = !error && status ? slugStatusView(status) : null;
  const tone: SlugStatusTone | null = error ? 'error' : view?.tone ?? null;
  const blurSx = blur ? { '& .MuiInputBase-input': { filter: 'blur(5px)', userSelect: 'none' } } : undefined;

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems="flex-start">
        <TextField
          fullWidth
          required
          label={t.label}
          placeholder={t.placeholder}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(normalizeSlugInput(e.target.value))}
          error={tone === 'error'}
          color={tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : undefined}
          inputProps={{
            maxLength: STOREFRONT_RANGES.slug.max, autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false,
            'aria-describedby': [ids.status, ids.rule, suggestions.length > 0 && ids.suggestions].filter(Boolean).join(' '),
            'aria-invalid': tone === 'error',
          }}
          InputProps={{
            endAdornment: hostname ? (
              <InputAdornment position="end">
                <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                  .{hostname}
                </Typography>
              </InputAdornment>
            ) : undefined,
          }}
          sx={{ flex: 3, ...blurSx }}
        />
        {domains.length > 1 && (
          <TextField
            select
            label={t.domainLabel}
            value={domainId}
            disabled={disabled}
            onChange={(e) => onDomainChange(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><AppIcon icon={Globe} size="sm" /></InputAdornment> }}
            sx={{ flex: 2, width: { xs: '100%', sm: 'auto' }, minWidth: 0 }}
          >
            {domains.map((d) => <MenuItem key={d.id} value={d.id}>{d.hostname}</MenuItem>)}
          </TextField>
        )}
      </Stack>

      <Box id={ids.status} aria-live="polite" sx={{ mx: 1.75, mt: 0.5, minHeight: 20 }}>
        {checking ? (
          <Stack direction="row" spacing={0.75} alignItems="center">
            <CircularProgress size={12} aria-hidden />
            <FormHelperText sx={{ m: 0 }}>{t.checking}</FormHelperText>
          </Stack>
        ) : tone ? (
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: `${tone}.main` }}>
            <AppIcon icon={TONE_ICON[tone]} size="sm" />
            <FormHelperText data-tone={tone} sx={{ m: 0, color: 'inherit' }}>{error ?? view?.text}</FormHelperText>
          </Stack>
        ) : null}
      </Box>
      <FormHelperText id={ids.rule} sx={{ mx: 1.75 }}>{t.rule}</FormHelperText>

      {suggestions.length > 0 && (
        <Box id={ids.suggestions} sx={{ mt: 1.25 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>{t.suggestionsLabel}</Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
            {suggestions.map((s) => (
              <Box component="li" key={s}>
                <Tooltip title={`${s}.${hostname}`} arrow>
                  <Chip
                    label={s}
                    clickable
                    disabled={disabled}
                    color="primary"
                    variant="outlined"
                    icon={<AppIcon icon={Sparkles} size="sm" />}
                    onClick={() => onChange(s)}
                    sx={blur ? { '& .MuiChip-label': { filter: 'blur(5px)' } } : undefined}
                  />
                </Tooltip>
              </Box>
            ))}
          </Stack>
        </Box>
      )}
    </Box>
  );
}
