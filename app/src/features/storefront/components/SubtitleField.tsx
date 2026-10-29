import { Box, Chip, InputAdornment, Stack, TextField, Typography } from '@mui/material';
import { storefrontStrings } from '../strings';
import { STOREFRONT_RANGES } from '../types';

const t = storefrontStrings.fields.subtitle;
const MAX = STOREFRONT_RANGES.subtitleMax;

export interface SubtitleFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Sugestões da API (`overview.subtitleSuggestions`, até 4). */
  suggestions: string[];
  error?: string;
  disabled?: boolean;
}

/** Subtítulo livre (até 80) com sugestões prontas: clicar preenche o campo. */
export function SubtitleField({ value, onChange, suggestions, error, disabled }: SubtitleFieldProps) {
  const n = value.length;
  return (
    <Box>
      <TextField
        fullWidth
        label={t.label}
        placeholder={t.placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.slice(0, MAX))}
        error={Boolean(error)}
        helperText={error ?? t.help}
        inputProps={{ maxLength: MAX }}
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <Typography variant="caption" color={n >= MAX ? 'warning.main' : 'text.secondary'}>{t.counter(n)}</Typography>
            </InputAdornment>
          ),
        }}
      />
      {suggestions.length > 0 && (
        <Box sx={{ mt: 1.25 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>{t.suggestionsLabel}</Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
            {suggestions.slice(0, 4).map((s) => {
              const selected = value.trim() === s;
              return (
                <Box component="li" key={s}>
                  <Chip
                    label={s}
                    clickable
                    disabled={disabled}
                    color={selected ? 'primary' : 'default'}
                    variant={selected ? 'filled' : 'outlined'}
                    aria-pressed={selected}
                    onClick={() => onChange(s.slice(0, MAX))}
                  />
                </Box>
              );
            })}
          </Stack>
        </Box>
      )}
    </Box>
  );
}
