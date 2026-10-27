import { Box, Chip, Divider, Stack, Typography } from '@mui/material';
import { RangeSlider } from '@/components';
import { GroupChip } from '../GroupChip';
import { Blurred, useBlur } from '@/features/privacy';
import type { SelectedGroup } from './ConfigGroupsStep';
import { offerStrings } from '../../strings';
import { INTERVAL_MAX_SECONDS, INTERVAL_MIN_SECONDS, INTERVAL_STEP_SECONDS, intervalRisk, intervalValid } from '../../utils/offerConfig';

const t = offerStrings.wizard.confirm;
const MAX_CHIPS = 12;

interface Props {
  sessionName: string;
  groups: SelectedGroup[];
  intervalMin: number;
  intervalMax: number;
  onInterval: (min: number, max: number) => void;
}

/** Passo 3: resumo + intervalo entre grupos. */
export function ConfigConfirmStep({ sessionName, groups, intervalMin, intervalMax, onInterval }: Props) {
  const invalid = !intervalValid(intervalMin, intervalMax);
  const risk = intervalRisk(intervalMin, intervalMax);
  const blurSession = useBlur('offers.sessionName');
  const shown = groups.slice(0, MAX_CHIPS);
  const rest = groups.length - shown.length;

  return (
    <Stack spacing={2.5} divider={<Divider flexItem />}>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
        <Box>
          <Typography variant="caption" color="text.secondary">{t.session}</Typography>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }} noWrap><Blurred when={blurSession} inline radius={5}>{sessionName}</Blurred></Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">{t.total}</Typography>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{groups.length}</Typography>
        </Box>
      </Box>

      <Box>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>{t.groups}</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {shown.map((g, i) => <GroupChip key={`${g.title}-${i}`} title={g.title} avatarUrl={g.avatarUrl} untitled={offerStrings.wizard.groups.untitled} sx={{ maxWidth: 240 }} />)}
          {rest > 0 && <Chip size="small" variant="outlined" label={t.more(rest)} />}
        </Box>
      </Box>

      <Box>
        <Typography variant="subtitle2">{t.interval}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{t.intervalHelper}</Typography>
        <Box sx={{ maxWidth: 560 }}>
          <RangeSlider
            value={[intervalMin, intervalMax]}
            min={INTERVAL_MIN_SECONDS}
            max={INTERVAL_MAX_SECONDS}
            step={INTERVAL_STEP_SECONDS}
            minDistance={INTERVAL_STEP_SECONDS}
            ariaLabel={t.interval}
            minLabel={t.min}
            maxLabel={t.max}
            formatValue={t.minutes}
            status={{ score: risk.score, label: t.risk[risk.level], ariaLabel: t.riskAria }}
            error={invalid}
            onChange={([min, max]) => onInterval(min, max)}
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
