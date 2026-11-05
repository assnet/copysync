import { Box, Typography } from '@mui/material';
import { CalendarClock } from 'lucide-react';
import { AppIcon, PostingWindowField, type PostingWindowValue } from '@/components';
import { offerStrings } from '../../strings';

const t = offerStrings.wizard.schedule;

interface Props {
  value: PostingWindowValue;
  onChange: (value: PostingWindowValue) => void;
  disabled?: boolean;
}

/** Passo "Horário" do assistente: faixa do dia + dias da semana em que o gerador posta. */
export function ConfigScheduleStep({ value, onChange, disabled }: Props) {
  return (
    <Box sx={{ maxWidth: 560 }}>
      <PostingWindowField value={value} onChange={onChange} disabled={disabled} />
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mt: 2, color: 'text.secondary' }}>
        <Box component="span" sx={{ display: 'inline-flex', mt: '2px', flexShrink: 0 }}>
          <AppIcon icon={CalendarClock} size="sm" />
        </Box>
        <Typography variant="caption" component="p">{t.scheduledNote}</Typography>
      </Box>
    </Box>
  );
}
