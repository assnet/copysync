import { TextField } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { ToggleOption } from '@/components';
import { offerStrings } from '../strings';
import { SCHEDULE_MAX_DAYS, scheduleBounds } from '../utils/offerSchedule';

const t = offerStrings.schedule;

interface Props {
  enabled: boolean;
  /** Valor do `datetime-local` (hora local). */
  value: string;
  onToggle: (enabled: boolean) => void;
  onChange: (value: string) => void;
  /** Confirma o valor digitado (ex.: gravar na oferta). */
  onCommit?: () => void;
  error?: string | null;
  disabled?: boolean;
}

/** "Agendar início" dos disparos: chave + data/hora nativa (sem lib de datas). */
export function OfferScheduleField({ enabled, value, onToggle, onChange, onCommit, error, disabled }: Props) {
  const theme = useTheme();
  const { min, max } = scheduleBounds();

  return (
    <ToggleOption checked={enabled} disabled={disabled} onChange={onToggle} title={t.title} description={t.description}>
      <TextField
        type="datetime-local"
        size="small"
        label={t.label}
        value={value}
        disabled={disabled}
        error={Boolean(error)}
        helperText={error ?? t.helper(SCHEDULE_MAX_DAYS)}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onCommit?.(); } }}
        sx={{ maxWidth: 280, width: '100%' }}
        slotProps={{
          inputLabel: { shrink: true },
          // Seletor nativo acompanha o tema (claro/escuro)
          htmlInput: { min, max, style: { colorScheme: theme.palette.mode } },
        }}
      />
    </ToggleOption>
  );
}
