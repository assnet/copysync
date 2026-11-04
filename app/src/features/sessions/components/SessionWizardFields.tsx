import { Alert, Box, TextField, Typography, alpha, useTheme } from '@mui/material';
import { Info } from 'lucide-react';
import { AppIcon } from '@/components';
import { sessionStrings } from '../strings';
import { SESSION_NAME_MAX } from '../utils';

interface PhoneFormProps {
  formId: string;
  title: string;
  label: string;
  placeholder: string;
  howTo: { title: string; body: string; format: string };
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  onSubmit: () => void;
  error: boolean;
  helperText: string;
  autoComplete: string;
}

/** Passo "Número/Telefone": caixa de ajuda + campo. Igual para WhatsApp e Telegram, só os textos mudam. */
export function SessionPhoneForm({
  formId, title, label, placeholder, howTo, value, onChange, onBlur, onSubmit, error, helperText, autoComplete,
}: PhoneFormProps) {
  const theme = useTheme();
  return (
    <Box
      component="form"
      noValidate
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      id={formId}
      sx={{ display: 'grid', gap: 2.5 }}
    >
      <Typography variant="h6" component="h2" fontWeight={700}>{title}</Typography>
      <Box
        sx={{
          display: 'flex', gap: 1.5, p: 2, borderRadius: 2,
          bgcolor: alpha(theme.palette.info.main, 0.08),
          border: '1px solid', borderColor: alpha(theme.palette.info.main, 0.25),
        }}
      >
        <Box sx={{ color: 'info.main', mt: 0.25, display: 'flex' }}><AppIcon icon={Info} size="md" /></Box>
        <Box>
          <Typography variant="subtitle2">{howTo.title}</Typography>
          <Typography variant="body2" color="text.secondary">{howTo.body}</Typography>
          <Typography variant="body2" color="text.secondary">{howTo.format}</Typography>
        </Box>
      </Box>
      <TextField
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d\s()+-]/g, '').slice(0, 20))}
        onBlur={onBlur}
        placeholder={placeholder}
        autoFocus
        fullWidth
        autoComplete={autoComplete}
        inputProps={{ inputMode: 'tel' }}
        error={error}
        helperText={helperText}
      />
    </Box>
  );
}

interface NameFormProps {
  formId: string;
  title: string;
  placeholder: string;
  helper: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  onSubmit: () => void;
  invalid: boolean;
  disabled: boolean;
  createError: string | null;
}

/** Passo "Nome": campo com contador e erro de criação. */
export function SessionNameForm({
  formId, title, placeholder, helper, value, onChange, onBlur, onSubmit, invalid, disabled, createError,
}: NameFormProps) {
  const t = sessionStrings.wizard.name;
  return (
    <Box
      component="form"
      noValidate
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      id={formId}
      sx={{ display: 'grid', gap: 2.5 }}
    >
      <Typography variant="h6" component="h2" fontWeight={700}>{title}</Typography>
      {createError && <Alert severity="error">{createError}</Alert>}
      <TextField
        label={t.label}
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, SESSION_NAME_MAX))}
        onBlur={onBlur}
        placeholder={placeholder}
        autoFocus
        fullWidth
        disabled={disabled}
        error={invalid}
        helperText={invalid ? t.tooShort : helper}
        InputProps={{
          endAdornment: (
            <Typography variant="caption" color="text.disabled" sx={{ whiteSpace: 'nowrap' }}>
              {t.counter(value.length, SESSION_NAME_MAX)}
            </Typography>
          ),
        }}
      />
    </Box>
  );
}
