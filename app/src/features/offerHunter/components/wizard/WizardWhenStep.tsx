import { useId, useState } from 'react';
import { Alert, Box, Button, FormControlLabel, MenuItem, Radio, RadioGroup, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Play } from 'lucide-react';
import { AppIcon, PostingWindowField } from '@/components';
import { OFFER_HUNT_DELIVERY_MODES, type HuntOptions, type OfferHuntDeliveryMode } from '../../types';
import { offerHunterStrings as t } from '../../strings';
import { useOfferHunt } from '../../hooks';
import { RunResultPanel } from '../RunResultPanel';
import { intervalChoices, type FieldErrors, type HuntWizardDraft } from './wizardDraft';
import { FieldHeading } from './fields';

const wh = t.wizard.when;
const tips = t.wizard.tips;
const test = t.wizard.test;

interface Props {
  draft: HuntWizardDraft;
  options: HuntOptions;
  errors: FieldErrors;
  onChange: (patch: Partial<HuntWizardDraft>) => void;
  /** Caçada já salva (edição): libera "Testar agora". */
  huntId?: string;
}

/** Passo 3: intervalo, dias/horário (componente do gerador), modo de entrega e teste. */
export function WizardWhenStep({ draft, options, errors, onChange, huntId }: Props) {
  const theme = useTheme();
  const deliveryId = useId();
  const choices = intervalChoices(options.limits, draft.intervalMinutes);

  return (
    <Stack spacing={3}>
      <TextField
        select
        label={wh.interval}
        value={draft.intervalMinutes}
        onChange={(e) => onChange({ intervalMinutes: Number(e.target.value) })}
        error={Boolean(errors.intervalMinutes)}
        helperText={errors.intervalMinutes ?? t.wizard.intervalHelp(t.interval(options.limits.intervalMinutesMin))}
        sx={{ maxWidth: { sm: 280 } }}
        fullWidth
      >
        {choices.map((m) => <MenuItem key={m} value={m}>{t.interval(m)}</MenuItem>)}
      </TextField>

      <Box>
        <FieldHeading label={wh.window} tip={tips.window} />
        <PostingWindowField value={draft.postingWindow} onChange={(postingWindow) => onChange({ postingWindow })} />
        {errors.weekdaysMask && <Typography variant="caption" color="error" component="p" sx={{ mt: 1 }}>{errors.weekdaysMask}</Typography>}
      </Box>

      <Box>
        <FieldHeading id={deliveryId} label={wh.deliveryMode} tip={tips.deliveryMode} />
        <RadioGroup
          aria-labelledby={deliveryId}
          value={draft.deliveryMode}
          onChange={(_e, v) => onChange({ deliveryMode: v as OfferHuntDeliveryMode })}
          sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}
        >
          {OFFER_HUNT_DELIVERY_MODES.map((mode) => {
            const selected = draft.deliveryMode === mode;
            const m = t.deliveryModes[mode];
            return (
              <FormControlLabel
                key={mode}
                value={mode}
                control={<Radio size="small" />}
                label={(
                  <Box sx={{ py: 0.5 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{m.label}</Typography>
                    <Typography variant="caption" color="text.secondary" component="p" sx={{ lineHeight: 1.35 }}>{m.hint}</Typography>
                  </Box>
                )}
                sx={{
                  m: 0, pr: 1.5, alignItems: 'flex-start', borderRadius: 2, border: '1px solid',
                  borderColor: selected ? 'primary.main' : 'divider',
                  backgroundColor: selected ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.12 : 0.06) : 'transparent',
                  '& .MuiRadio-root': { mt: 0.25 },
                }}
              />
            );
          })}
        </RadioGroup>
      </Box>

      {huntId && <WizardTestPanel huntId={huntId} />}
    </Stack>
  );
}

/** "Testar agora": roda a caçada salva (`useOfferHunt(id).run`) e mostra o ranking. */
function WizardTestPanel({ huntId }: { huntId: string }) {
  const { run, running, lastRun } = useOfferHunt(huntId);
  const [error, setError] = useState<unknown>(null);
  const start = async () => {
    setError(null);
    try {
      await run();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 2.5 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, mb: 1 }}>
        <Tooltip title={test.tooltip} arrow describeChild>
          <span>
            <Button variant="outlined" startIcon={<AppIcon icon={Play} size="sm" />} onClick={start} disabled={running}>
              {running ? test.running : test.action}
            </Button>
          </span>
        </Tooltip>
      </Box>
      <Alert severity="info" sx={{ mb: 1.5 }}>{test.spendsQuota} {test.savedOnly}</Alert>
      <RunResultPanel title={test.title} running={running} result={lastRun} error={error} />
    </Box>
  );
}
