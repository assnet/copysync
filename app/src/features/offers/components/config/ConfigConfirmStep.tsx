import { Box, Chip, Divider, Stack, TextField, Typography } from '@mui/material';
import { offerStrings } from '../../strings';
import { INTERVAL_MAX_SECONDS, INTERVAL_MIN_SECONDS, intervalValid } from '../../utils/offerConfig';

const t = offerStrings.wizard.confirm;
const MAX_CHIPS = 12;

interface Props {
  sessionName: string;
  groupTitles: string[];
  intervalMin: number;
  intervalMax: number;
  onInterval: (min: number, max: number) => void;
}

const toInt = (raw: string) => (raw === '' ? Number.NaN : Math.trunc(Number(raw)));

/** Passo 3: resumo + intervalo entre grupos. */
export function ConfigConfirmStep({ sessionName, groupTitles, intervalMin, intervalMax, onInterval }: Props) {
  const invalid = !intervalValid(intervalMin, intervalMax);
  const shown = groupTitles.slice(0, MAX_CHIPS);
  const rest = groupTitles.length - shown.length;
  const field = (v: number) => (Number.isNaN(v) ? '' : String(v));

  return (
    <Stack spacing={2.5} divider={<Divider flexItem />}>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
        <Box>
          <Typography variant="caption" color="text.secondary">{t.session}</Typography>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }} noWrap>{sessionName}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">{t.total}</Typography>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{groupTitles.length}</Typography>
        </Box>
      </Box>

      <Box>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>{t.groups}</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {shown.map((title, i) => <Chip key={`${title}-${i}`} size="small" label={title} sx={{ maxWidth: 240 }} />)}
          {rest > 0 && <Chip size="small" variant="outlined" label={t.more(rest)} />}
        </Box>
      </Box>

      <Box>
        <Typography variant="subtitle2">{t.interval}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{t.intervalHelper}</Typography>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', sm: '180px 180px' } }}>
          <TextField
            size="small"
            type="number"
            label={t.min}
            value={field(intervalMin)}
            error={invalid}
            onChange={(e) => onInterval(toInt(e.target.value), intervalMax)}
            slotProps={{ htmlInput: { min: INTERVAL_MIN_SECONDS, max: INTERVAL_MAX_SECONDS, inputMode: 'numeric' } }}
          />
          <TextField
            size="small"
            type="number"
            label={t.max}
            value={field(intervalMax)}
            error={invalid}
            onChange={(e) => onInterval(intervalMin, toInt(e.target.value))}
            slotProps={{ htmlInput: { min: INTERVAL_MIN_SECONDS, max: INTERVAL_MAX_SECONDS, inputMode: 'numeric' } }}
          />
        </Box>
        {invalid && (
          <Typography variant="caption" color="error" component="p" role="alert" sx={{ mt: 0.75 }}>
            {t.intervalError(INTERVAL_MIN_SECONDS, INTERVAL_MAX_SECONDS)}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}
