import { useEffect, useState, type ReactNode } from 'react';
import { Box, IconButton, InputAdornment, TextField, Tooltip, Typography } from '@mui/material';
import { Info } from 'lucide-react';
import { AppIcon } from '@/components';
import { offerHunterStrings } from '../../strings';

const tips = offerHunterStrings.wizard.tips;

/** Ícone de ajuda com Tooltip (toque abre no celular). */
export function FieldTip({ title, field }: { title: string; field: string }) {
  return (
    <Tooltip title={title} arrow describeChild enterTouchDelay={0} leaveTouchDelay={4000}>
      <IconButton size="small" aria-label={tips.helpAria(field)} sx={{ color: 'text.secondary', p: 0.5 }}>
        <AppIcon icon={Info} size="sm" />
      </IconButton>
    </Tooltip>
  );
}

/** Título de bloco com ajuda ao lado. */
export function FieldHeading({ id, label, tip, children }: { id?: string; label: string; tip: string; children?: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, mb: 0.75 }}>
      <Typography id={id} variant="subtitle2" component="p" sx={{ fontWeight: 600 }}>{label}</Typography>
      <FieldTip title={tip} field={label} />
      {children}
    </Box>
  );
}

interface NumberFieldProps {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  tip: string;
  /** Valor guardado ÷ escala = valor exibido (centavos → reais: 100). */
  scale?: number;
  decimals?: boolean;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  helperText?: string;
  error?: string;
  name?: string;
}

const show = (value: number | null, scale: number) => (value == null ? '' : String(value / scale).replace('.', ','));

/**
 * Número opcional (vazio = sem filtro): aceita só dígitos e uma vírgula; o texto local evita perder
 * "4," no meio da digitação.
 */
export function NumberField({
  label, value, onChange, tip, scale = 1, decimals, prefix, suffix, placeholder, helperText, error, name,
}: NumberFieldProps) {
  const [text, setText] = useState(() => show(value, scale));
  useEffect(() => {
    const parsed = text === '' ? null : Math.round(Number(text.replace(',', '.')) * scale * 100) / 100;
    if (parsed !== value) setText(show(value, scale));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, scale]);

  const change = (raw: string) => {
    let clean = raw.replace('.', ',').replace(/[^\d,]/g, '');
    if (!decimals) clean = clean.replace(/,/g, '');
    else {
      const [int, ...rest] = clean.split(',');
      clean = rest.length ? `${int},${rest.join('').slice(0, 2)}` : int!;
    }
    setText(clean);
    if (clean === '' || clean === ',') return onChange(null);
    const n = Number(clean.replace(',', '.'));
    onChange(Number.isFinite(n) ? Math.round(n * scale * 100) / 100 : null);
  };

  return (
    <TextField
      label={label}
      name={name}
      value={text}
      onChange={(e) => change(e.target.value)}
      placeholder={placeholder}
      error={Boolean(error)}
      helperText={error ?? helperText}
      size="small"
      fullWidth
      slotProps={{
        htmlInput: { inputMode: decimals ? 'decimal' : 'numeric', autoComplete: 'off' },
        input: {
          startAdornment: prefix ? <InputAdornment position="start">{prefix}</InputAdornment> : undefined,
          endAdornment: (
            <InputAdornment position="end" sx={{ gap: 0.5 }}>
              {suffix && <Typography component="span" variant="body2" color="text.secondary">{suffix}</Typography>}
              <FieldTip title={tip} field={label} />
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
