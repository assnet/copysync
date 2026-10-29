import { useId, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Paper, Slider, Snackbar, Stack, Switch, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { AppIcon, RangeSlider, SectionCard, ToggleOption } from '@/components';
import { Info } from 'lucide-react';
import { usePersistedState } from '@/hooks/usePersistedState';
import type { GroupMonitorConfigResponse, GroupMonitorSettings, MonitorTextMode } from '@/types/api.types';
import { AudiencePicker } from '@/features/offers/components/AudiencePicker';
import { formatDuration, monitoringStrings } from '../strings';
import { isFullDay, isWindowValid } from '../utils/operatingWindow';
import {
  LIMITS, SETTINGS_DRAFT_VERSION, draftToSettings, isDraftDirty, secondsToSliderMinutes, settingsToDraft, sliderMinutesToSeconds,
  type MonitorSettingsDraft,
} from '../utils/settingsDraft';
import { uiErrorMessage } from '../utils/apiErrors';
import { FieldLabel } from './FieldLabel';
import { OperatingWindowField } from './OperatingWindowField';

const t = monitoringStrings.form;

interface ValueSliderProps {
  label: string;
  help: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
}

/** Um valor só (atraso, validade): rótulo com ajuda, valor à direita e a barra. */
function ValueSlider({ label, help, value, min, max, step = 1, format, onChange, disabled }: ValueSliderProps) {
  const id = useId();
  return (
    <Box>
      <FieldLabel id={id} help={help} value={format(value)}>{label}</FieldLabel>
      <Slider
        aria-labelledby={id}
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled || min === max}
        valueLabelDisplay="off"
        getAriaValueText={format}
        onChange={(_e, v) => onChange(Array.isArray(v) ? v[0]! : v)}
        sx={(theme) => ({ mx: 1, width: 'calc(100% - 16px)', '& .MuiSlider-rail': { opacity: theme.palette.mode === 'dark' ? 0.5 : 0.38 } })}
      />
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }} aria-hidden>
        <Typography variant="caption" color="text.disabled">{format(min)}</Typography>
        <Typography variant="caption" color="text.disabled">{format(max)}</Typography>
      </Box>
    </Box>
  );
}

/** Recurso anunciado: switch desligado e travado, com o selo "Em breve". */
function UpcomingOption({ title, help }: { title: string; help: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, px: 1.5, py: 1.25, border: 1, borderColor: 'divider', borderRadius: 2, opacity: 0.8 }}>
      <Switch checked={false} disabled inputProps={{ 'aria-label': title }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{title}</Typography>
          <Chip size="small" color="primary" variant="outlined" label={t.soon} />
        </Box>
        <Typography variant="caption" color="text.secondary">{help}</Typography>
      </Box>
    </Box>
  );
}

interface Props {
  sessionId: string;
  config: GroupMonitorConfigResponse;
  /** Lança em erro. */
  onSave: (settings: GroupMonitorSettings) => Promise<unknown>;
}

/**
 * Configuração do monitoramento da sessão. Monte com `key={sessionId}`: o rascunho é lido do
 * storage só no mount (chave por sessão); `null` = sem alteração, vale o salvo.
 */
export function MonitoringSettingsForm({ sessionId, config, onSave }: Props) {
  const [draft, setDraft, clearDraft] = usePersistedState<MonitorSettingsDraft | null>(
    `monitoring.settings.${sessionId}`,
    null,
    { version: SETTINGS_DRAFT_VERSION },
  );
  const [saving, setSaving] = useState(false);
  // Rascunho mais recente: alteração feita durante o salvar não é apagada pelo clear
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [error, setError] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState(false);
  const value = draft ?? settingsToDraft(config.settings);
  const dirty = isDraftDirty(draft, config.settings);
  const windowValid = isWindowValid(value.window);
  const fullDay = isFullDay(value.window);
  const mentionAllEnabled = config.limits.mentionAllEnabled;
  const missingGroups = config.monitoredGroups.length === 0 || config.broadcastGroups.length === 0;

  const patch = (p: Partial<MonitorSettingsDraft>) => setDraft({ ...value, ...p });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const sent = draft;
      await onSave(draftToSettings({ ...value, mentionAll: mentionAllEnabled && value.mentionAll }));
      if (draftRef.current === sent) clearDraft();
      setSavedToast(true);
    } catch (err) {
      setError(uiErrorMessage(err, { scope: 'settings' }));
    } finally {
      setSaving(false);
    }
  };

  const minutes = (n: number) => t.minutes(n);

  return (
    <Stack spacing={2.5}>
      <ToggleOption
        checked={value.enabled}
        onChange={(enabled) => patch({ enabled })}
        title={t.enabledTitle}
        description={value.enabled ? t.enabledOn : t.enabledOff}
      />
      {value.enabled && missingGroups && <Alert severity="warning">{t.enabledMissingGroups}</Alert>}

      <SectionCard title={t.windowTitle} subtitle={t.windowSubtitle}>
        <Stack spacing={2.5}>
          <OperatingWindowField value={value.window} onChange={(window) => patch({ window })} />
          <Tooltip title={fullDay ? t.captureOutsideFullDay : ''} arrow placement="top">
            <Box>
              <ToggleOption
                checked={value.captureOutsideWindow}
                onChange={(captureOutsideWindow) => patch({ captureOutsideWindow })}
                title={t.captureOutsideTitle}
                description={fullDay ? t.captureOutsideFullDay : value.captureOutsideWindow ? t.captureOutsideOn : t.captureOutsideOff}
                disabled={fullDay}
              />
            </Box>
          </Tooltip>
        </Stack>
      </SectionCard>

      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' } }}>
        <SectionCard title={t.dispatchTitle} subtitle={t.dispatchSubtitle} sx={{ height: '100%' }}>
          <Stack spacing={2.5}>
            <Box>
              <FieldLabel help={t.intervalHelp}>{t.intervalLabel}</FieldLabel>
              <RangeSlider
                value={[secondsToSliderMinutes(value.intervalMinSeconds, LIMITS.intervalMinutes), secondsToSliderMinutes(value.intervalMaxSeconds, LIMITS.intervalMinutes)]}
                onChange={([lo, hi]) => patch({
                  intervalMinSeconds: sliderMinutesToSeconds(lo, value.intervalMinSeconds, LIMITS.intervalMinutes),
                  intervalMaxSeconds: sliderMinutesToSeconds(hi, value.intervalMaxSeconds, LIMITS.intervalMinutes),
                })}
                min={LIMITS.intervalMinutes.min}
                max={LIMITS.intervalMinutes.max}
                ariaLabel={t.intervalAria}
                minLabel={t.intervalMin}
                maxLabel={t.intervalMax}
                formatValue={minutes}
              />
            </Box>
            <ToggleOption
              checked={value.simulateTyping}
              onChange={(simulateTyping) => patch({ simulateTyping })}
              title={t.typingTitle}
              description={t.typingHelp}
            >
              <ValueSlider
                label={t.typingLabel}
                help={t.typingHelp}
                value={value.typingSeconds}
                min={LIMITS.typingSeconds.min}
                max={LIMITS.typingSeconds.max}
                format={t.seconds}
                onChange={(typingSeconds) => patch({ typingSeconds })}
              />
            </ToggleOption>
            <Tooltip title={mentionAllEnabled ? '' : t.mentionAllLocked} arrow placement="top">
              <Box>
                <ToggleOption
                  checked={mentionAllEnabled && value.mentionAll}
                  onChange={(mentionAll) => patch({ mentionAll })}
                  title={t.mentionAllTitle}
                  description={mentionAllEnabled ? t.mentionAllHelp : t.mentionAllLocked}
                  disabled={!mentionAllEnabled}
                />
              </Box>
            </Tooltip>
          </Stack>
        </SectionCard>

        <SectionCard title={t.afterTitle} subtitle={t.afterSubtitle} sx={{ height: '100%' }}>
          <Stack spacing={2.5}>
            <Alert severity="info" icon={<AppIcon icon={Info} size="sm" />}>{t.afterHelp}</Alert>
            <ValueSlider
              label={t.delayLabel}
              help={t.delayHelp}
              value={secondsToSliderMinutes(value.startDelaySeconds, LIMITS.startDelayMinutes)}
              min={LIMITS.startDelayMinutes.min}
              max={LIMITS.startDelayMinutes.max}
              format={(n) => (n === 0 ? t.delayNone : formatDuration(n))}
              onChange={(m) => patch({ startDelaySeconds: sliderMinutesToSeconds(m, value.startDelaySeconds, LIMITS.startDelayMinutes) })}
            />
            <ValueSlider
              label={t.maxAgeLabel}
              help={t.maxAgeHelp}
              value={value.maxOfferAgeMinutes}
              min={LIMITS.offerAgeMinutes.min}
              max={LIMITS.offerAgeMinutes.max}
              step={LIMITS.offerAgeMinutes.step}
              format={formatDuration}
              onChange={(maxOfferAgeMinutes) =>
                patch({ maxOfferAgeMinutes, couponMaxAgeMinutes: Math.min(value.couponMaxAgeMinutes, maxOfferAgeMinutes) })
              }
            />
            <ValueSlider
              label={t.couponAgeLabel}
              help={t.couponAgeHelp}
              value={Math.min(value.couponMaxAgeMinutes, value.maxOfferAgeMinutes)}
              min={LIMITS.offerAgeMinutes.min}
              max={value.maxOfferAgeMinutes}
              step={LIMITS.offerAgeMinutes.step}
              format={formatDuration}
              onChange={(couponMaxAgeMinutes) => patch({ couponMaxAgeMinutes })}
            />
          </Stack>
        </SectionCard>
      </Box>

      <SectionCard title={t.textTitle} subtitle={t.textSubtitle}>
        <Stack spacing={2}>
          <ToggleButtonGroup
            exclusive
            fullWidth
            color="primary"
            value={value.textMode}
            aria-label={t.textModeAria}
            onChange={(_, mode: MonitorTextMode | null) => { if (mode) patch({ textMode: mode }); }}
            sx={{ '& .MuiToggleButton-root': { textTransform: 'none', py: 1 } }}
          >
            {(Object.keys(t.textModes) as MonitorTextMode[]).map((mode) => (
              <ToggleButton key={mode} value={mode}>{t.textModes[mode].label}</ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Typography variant="body2" color="text.secondary">{t.textModes[value.textMode].help}</Typography>
          {value.textMode === 'AI' && (
            <AudiencePicker value={value.audience} onChange={(audience) => patch({ audience })} label={t.audienceLabel} />
          )}
          <ToggleOption
            checked={value.enrichLinkOnly}
            onChange={(enrichLinkOnly) => patch({ enrichLinkOnly })}
            title={t.enrichTitle}
            description={t.enrichHelp}
          />
          <Alert severity="info" icon={<AppIcon icon={Info} size="sm" />}>{t.textProductNote}</Alert>
        </Stack>
      </SectionCard>

      <SectionCard title={t.upcomingTitle}>
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
          <UpcomingOption title={t.imageTitle} help={t.imageHelp} />
        </Box>
      </SectionCard>

      {(dirty || error) && (
        <Paper
          elevation={6}
          sx={{
            position: 'sticky',
            bottom: 16,
            zIndex: (theme) => theme.zIndex.appBar - 1,
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 1.5,
            px: 2,
            py: 1.25,
            borderRadius: 2,
          }}
        >
          <Typography variant="body2" sx={{ flex: 1, minWidth: 160, fontWeight: 600 }} color={error ? 'error' : 'text.primary'}>
            {error ?? t.unsaved}
          </Typography>
          <Button onClick={() => { clearDraft(); setError(null); }} disabled={saving}>{t.discard}</Button>
          <Button
            variant="contained"
            onClick={() => void save()}
            disabled={saving || !windowValid || !dirty}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {saving ? t.saving : t.save}
          </Button>
        </Paper>
      )}

      <Snackbar
        open={savedToast}
        autoHideDuration={3000}
        onClose={() => setSavedToast(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity="success" onClose={() => setSavedToast(false)} sx={{ width: '100%' }}>{t.saved}</Alert>
      </Snackbar>
    </Stack>
  );
}
