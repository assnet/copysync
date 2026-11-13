import { useId } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, FormControlLabel, Paper, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material';
import { BrainCircuit } from 'lucide-react';
import { AppIcon, ToggleOption } from '@/components';
import { HUNT_AI_INTENT_MAX, type HuntProvider } from '../../types';
import { aiSuggestErrorMessage, draftFieldLabel, offerHunterStrings as t } from '../../strings';
import type { HuntWizardAiState } from './wizardDraft';

const a = t.wizard.aiSuggest;

interface Props {
  provider: HuntProvider | null;
  ai: HuntWizardAiState;
  /** Gate `aiAvailable` da loja e sem `AI_NOT_CONFIGURED` recebido. */
  available: boolean;
  /** Opções da loja carregadas (a sugestão se aplica sobre as predefinições dela). */
  ready: boolean;
  loading: boolean;
  errorCode: string | null;
  /** Sugestões que ainda restam hoje (null = ainda não chamou). */
  remainingToday: number | null;
  intentError?: string;
  onChange: (patch: Partial<HuntWizardAiState>) => void;
  onGenerate: () => void;
}

/**
 * "Deixar a IA decidir os filtros" (AI-01..06): interruptor (desligado por padrão), intenção (≤ 120) e "Deixar a
 * IA escolher o produto". "Gerar com IA" preenche o rascunho; nada é salvo. Copy separa este atalho do
 * "Escolha com IA" do Refino. Ícone neutro (cérebro/circuito), nunca brilho.
 */
export function WizardAiSuggestPanel({
  provider, ai, available, ready, loading, errorCode, remainingToday, intentError, onChange, onGenerate,
}: Props) {
  const hintId = useId();
  const intent = ai.intent;
  const hasInput = intent.trim().length > 0 || ai.pickProduct;
  const tooLong = intent.length > HUNT_AI_INTENT_MAX;
  const canGenerate = available && Boolean(provider) && ready && hasInput && !tooLong && !loading && remainingToday !== 0;
  const disabledReason = !available ? a.unavailable : !provider ? a.chooseStoreFirst : null;

  const toggle = (
    <FormControlLabel
      control={(
        <Switch
          checked={ai.on && available}
          disabled={!available || !provider}
          onChange={(_e, on) => onChange({ on })}
          slotProps={{ input: { 'aria-describedby': hintId } }}
        />
      )}
      label={(
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
          <Box component="span" sx={{ color: 'primary.main', display: 'inline-flex' }}><AppIcon icon={BrainCircuit} size="sm" /></Box>
          <Typography variant="subtitle2" component="span" sx={{ fontWeight: 700 }}>{a.title}</Typography>
        </Box>
      )}
      sx={{ ml: 0, gap: 1, mr: 0 }}
    />
  );

  const dropped = ai.dropped.map((path) => draftFieldLabel(path, provider ?? 'SHEIN'));
  const uniqueDropped = [...new Set(dropped)];

  return (
    <Paper variant="outlined" component="section" aria-label={a.title} sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 2 }}>
      {disabledReason ? (
        <Tooltip title={disabledReason} arrow describeChild enterTouchDelay={0}>
          <Box component="span" sx={{ display: 'inline-flex' }}>{toggle}</Box>
        </Tooltip>
      ) : toggle}
      <Typography id={hintId} variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
        {disabledReason ?? a.hint}
      </Typography>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5, fontStyle: 'italic' }}>{a.difference}</Typography>

      {ai.on && available && provider && (
        <Stack spacing={1.5} sx={{ mt: 1.5 }}>
          <TextField
            label={a.intent}
            value={intent}
            onChange={(e) => onChange({ intent: e.target.value })}
            placeholder={a.intentPlaceholder}
            multiline
            minRows={2}
            fullWidth
            error={tooLong || Boolean(intentError)}
            helperText={(
              <Box component="span" sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                <span>{intentError ?? (hasInput ? ' ' : a.needInput)}</span>
                <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{a.intentCounter(intent.length, HUNT_AI_INTENT_MAX)}</Box>
              </Box>
            )}
            slotProps={{ htmlInput: { maxLength: HUNT_AI_INTENT_MAX } }}
          />
          <ToggleOption
            checked={ai.pickProduct}
            onChange={(pickProduct) => onChange({ pickProduct })}
            title={a.pickProduct}
            description={a.pickProductHint}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Tooltip title={a.generateTooltip} arrow describeChild>
              <span>
                <Button
                  variant="contained"
                  disableElevation
                  onClick={onGenerate}
                  disabled={!canGenerate}
                  startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <AppIcon icon={BrainCircuit} size="sm" />}
                >
                  {loading ? a.generating : ai.applied ? a.regenerate : a.generate}
                </Button>
              </span>
            </Tooltip>
            {remainingToday !== null && (
              <Chip size="small" variant="outlined" label={a.remaining(remainingToday)} sx={{ fontVariantNumeric: 'tabular-nums' }} />
            )}
          </Box>
          {ai.applied && !loading && !errorCode && (
            <Alert severity="success" variant="outlined" icon={<AppIcon icon={BrainCircuit} size="md" />}>
              {a.applied} {a.replaces}
            </Alert>
          )}
          {uniqueDropped.length > 0 && !errorCode && (
            <Typography variant="caption" color="text.secondary" component="p" data-testid="ai-dropped">{a.dropped(uniqueDropped)}</Typography>
          )}
          {errorCode && <Alert severity={errorCode === 'OFFER_HUNT_AI_SUGGEST_DAILY_LIMIT' ? 'warning' : 'error'} role="alert">{aiSuggestErrorMessage(errorCode)}</Alert>}
        </Stack>
      )}
    </Paper>
  );
}
