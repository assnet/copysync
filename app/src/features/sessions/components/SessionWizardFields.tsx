import { Alert, Box, InputAdornment, TextField, Typography } from '@mui/material';
import { Phone } from 'lucide-react';
import { AppIcon } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { sessionStrings } from '../strings';
import { SESSION_NAME_MAX, type SessionChannel } from '../utils';
import { ChannelBridge } from './ChannelBridge';
import { SessionChannelChip } from './SessionChannelChip';

/** Título do passo (h2) + subtítulo opcional. */
function StepHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <Box>
      <Typography variant="h6" component="h2" fontWeight={700}>{title}</Typography>
      {subtitle && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{subtitle}</Typography>}
    </Box>
  );
}

interface PhoneFormProps {
  formId: string;
  /** Canal da sessão (ponte e cores). Padrão: whatsapp. */
  channel?: SessionChannel;
  title: string;
  subtitle?: string;
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

/** Passo "Número/Telefone": ponte celular ↔ canal, dica de formato e campo. Só os textos mudam por canal. */
export function SessionPhoneForm({
  formId, channel = 'whatsapp', title, subtitle, label, placeholder, howTo, value, onChange, onBlur, onSubmit,
  error, helperText, autoComplete,
}: PhoneFormProps) {
  return (
    <Box
      component="form"
      noValidate
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      id={formId}
      sx={{ display: 'grid', gap: 2.5 }}
    >
      <StepHeading title={title} subtitle={subtitle} />
      <Box sx={{ display: 'grid', justifyItems: 'center', gap: 1.25, textAlign: 'center', py: 0.5 }}>
        <ChannelBridge channel={channel} state="idle" size="sm" />
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
        InputProps={{
          startAdornment: (
            <InputAdornment position="start" sx={{ color: error ? 'error.main' : 'text.secondary' }}>
              <AppIcon icon={Phone} size="md" aria-hidden />
            </InputAdornment>
          ),
        }}
        error={error}
        helperText={helperText}
        sx={{ '& .MuiFormHelperText-root': { fontVariantNumeric: 'tabular-nums' } }}
      />
    </Box>
  );
}

interface NameFormProps {
  formId: string;
  /** Canal da sessão (chip da prévia). Padrão: whatsapp. */
  channel?: SessionChannel;
  title: string;
  subtitle?: string;
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

/** Passo "Nome": prévia viva do cartão, campo com contador e erro de criação. */
export function SessionNameForm({
  formId, channel = 'whatsapp', title, subtitle, placeholder, helper, value, onChange, onBlur, onSubmit,
  invalid, disabled, createError,
}: NameFormProps) {
  const t = sessionStrings.wizard.name;
  const blurName = useBlur('sessions.sessionName');
  const typed = value.trim();
  return (
    <Box
      component="form"
      noValidate
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      id={formId}
      sx={{ display: 'grid', gap: 2.5 }}
    >
      <StepHeading title={title} subtitle={subtitle} />
      {createError && <Alert severity="error">{createError}</Alert>}
      <Box
        aria-hidden
        sx={{
          display: 'grid', gap: 1, p: 2, borderRadius: '14px',
          border: '1px dashed', borderColor: 'divider', bgcolor: 'action.hover',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Typography variant="caption" color="text.secondary">{t.previewLabel}</Typography>
          <SessionChannelChip channel={channel} />
        </Box>
        <Blurred when={blurName && Boolean(typed)}>
          <Typography
            variant="subtitle1"
            fontWeight={700}
            noWrap
            color={typed ? 'text.primary' : 'text.disabled'}
          >
            {typed || placeholder}
          </Typography>
        </Blurred>
      </Box>
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
            <Typography variant="caption" color="text.disabled" sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
              {t.counter(value.length, SESSION_NAME_MAX)}
            </Typography>
          ),
        }}
      />
    </Box>
  );
}
