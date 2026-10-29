import { useId, type ChangeEvent } from 'react';
import { Box, InputAdornment, TextField, Tooltip } from '@mui/material';
import { normalizeHexColor } from '../storefrontForm';
import { storefrontStrings } from '../strings';

const t = storefrontStrings.fields.colors;
/** `<input type=color>` só aceita `#rrggbb` minúsculo; rascunho inválido mostra preto no swatch. */
const SWATCH_FALLBACK = '#000000';

export interface ColorFieldProps {
  label: string;
  /** Valor como digitado (pode estar inválido enquanto o usuário edita). */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/** Cor da página: swatch nativo + texto hex `#RRGGBB` validado. */
export function ColorField({ label, value, onChange, disabled }: ColorFieldProps) {
  const id = useId();
  const valid = normalizeHexColor(value);
  const error = valid ? undefined : t.invalid;

  return (
    <TextField
      fullWidth
      id={id}
      label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value.slice(0, 7))}
      onBlur={() => valid && valid !== value && onChange(valid)}
      error={Boolean(error)}
      helperText={error}
      inputProps={{ maxLength: 7, spellCheck: false, autoCapitalize: 'characters', style: { fontFamily: 'monospace' } }}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <Tooltip title={t.picker(label)} arrow>
              <Box
                component="input"
                type="color"
                aria-label={t.picker(label)}
                disabled={disabled}
                value={(valid ?? SWATCH_FALLBACK).toLowerCase()}
                onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value.toUpperCase())}
                sx={{
                  width: 28, height: 28, p: 0, border: 1, borderColor: 'divider', borderRadius: 1, cursor: 'pointer',
                  bgcolor: 'transparent',
                  '&::-webkit-color-swatch-wrapper': { p: 0 },
                  '&::-webkit-color-swatch': { border: 'none', borderRadius: 0.75 },
                  '&::-moz-color-swatch': { border: 'none', borderRadius: 0.75 },
                }}
              />
            </Tooltip>
          </InputAdornment>
        ),
      }}
    />
  );
}
