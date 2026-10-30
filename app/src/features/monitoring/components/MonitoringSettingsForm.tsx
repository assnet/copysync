import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  Alert, Box, Button, ButtonBase, Chip, CircularProgress, Paper, Slider, Snackbar, Stack, Switch, Tooltip, Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  AlertTriangle, Bot, Check, Clock, FileText, Hourglass, ImagePlus, Info, LayoutTemplate, Power, Quote, Timer, type LucideIcon,
} from 'lucide-react';
import { AppIcon, RangeSlider, ToggleOption } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import type { GroupMonitorConfigResponse, GroupMonitorSettings, MonitorTextMode } from '@/types/api.types';
import { AudiencePicker } from '@/features/offers/components/AudiencePicker';
import { formatDuration, monitoringStrings } from '../strings';
import {
  INNER_RADIUS, REDUCED_MOTION, floatShadow, glassPillSx, iconTileSx, surfaceSx, toneSurface, toneText,
} from '../monitoringStyle';
import { isFullDay, isWindowValid } from '../utils/operatingWindow';
import {
  LIMITS, SETTINGS_DRAFT_VERSION, TEXT_MODES, draftToSettings, effectiveDraft, isDraftDirty, secondsToSliderMinutes, settingsToDraft,
  sliderMinutesToSeconds, textModeForKey, type MonitorSettingsDraft,
} from '../utils/settingsDraft';
import { uiErrorMessage } from '../utils/apiErrors';
import { FieldLabel } from './FieldLabel';
import { MonitorCard } from './MonitorCard';
import { OperatingWindowField } from './OperatingWindowField';

const t = monitoringStrings.form;

/** Spinner parado com movimento reduzido (raiz gira, círculo pulsa). */
const SPINNER_REDUCED_MOTION_SX = { [REDUCED_MOTION]: { animation: 'none', '& .MuiCircularProgress-circle': { animation: 'none' } } };

const TEXT_MODE_ICONS: Record<MonitorTextMode, LucideIcon> = { ORIGINAL: Quote, TEMPLATE: LayoutTemplate, AI: Bot };

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

/** Um valor só (atraso, validade): rótulo com ajuda, valor à direita, barra e extremos como no `RangeSlider`. */
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
        sx={{
          mx: 1,
          width: 'calc(100% - 16px)',
          height: 6,
          '& .MuiSlider-thumb': { width: 22, height: 22, bgcolor: 'background.paper', border: '3px solid currentColor' },
        }}
      />
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }} aria-hidden>
        <Typography variant="caption" color="text.disabled" sx={{ fontVariantNumeric: 'tabular-nums' }}>{format(min)}</Typography>
        <Typography variant="caption" color="text.disabled" sx={{ fontVariantNumeric: 'tabular-nums' }}>{format(max)}</Typography>
      </Box>
    </Box>
  );
}

/** Nota de rodapé de seção: ícone `Info` em linha + legenda (substitui o `Alert` info empilhado). */
function Note({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, color: 'text.secondary' }}>
      <Box component="span" aria-hidden sx={{ display: 'inline-flex', mt: '0.15em', flexShrink: 0 }}>
        <AppIcon icon={Info} size="inline" />
      </Box>
      <Typography variant="caption" component="p" sx={{ lineHeight: 1.5 }}>{children}</Typography>
    </Box>
  );
}

interface MasterProps {
  enabled: boolean;
  missingGroups: boolean;
  onChange: (enabled: boolean) => void;
}

/** Card mestre do liga/desliga: tom success quando ligado; a linha inteira é o rótulo do switch. */
function MasterToggleCard({ enabled, missingGroups, onChange }: MasterProps) {
  const theme = useTheme();
  const titleId = useId();
  const descId = useId();
  const tone = enabled ? 'success' : 'neutral';
  const pill = toneSurface(theme, tone);

  return (
    <Box component="section" aria-labelledby={titleId} sx={[surfaceSx(theme, { tone }), { p: { xs: 2, sm: 2.5 } }]}>
      <Box component="label" sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1.5, sm: 2 }, cursor: 'pointer', minHeight: 44 }}>
        <Box sx={iconTileSx(theme, tone, 44)}>
          <AppIcon icon={Power} size="md" />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            {/* Dentro do <label> (alvo de toque da linha inteira): título como span com papel de h2 */}
            <Typography id={titleId} component="span" role="heading" aria-level={2} sx={{ typography: 'subtitle1', fontSize: '1.05rem', fontWeight: 700, lineHeight: 1.3 }}>
              {t.enabledTitle}
            </Typography>
            <Box component="span" aria-hidden sx={{ ...glassPillSx(theme), py: 0.25, color: pill.color, bgcolor: pill.backgroundColor, borderColor: pill.borderColor }}>
              {enabled ? t.masterOn : t.masterOff}
            </Box>
          </Box>
          <Typography id={descId} variant="body2" component="span" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
            {enabled ? t.enabledOn : t.enabledOff}
          </Typography>
        </Box>
        <Switch
          checked={enabled}
          onChange={(_e, v) => onChange(v)}
          color="success"
          slotProps={{ input: { 'aria-labelledby': titleId, 'aria-describedby': descId } }}
          sx={{ flexShrink: 0 }}
        />
      </Box>
      {enabled && missingGroups && (
        <Box
          role="note"
          sx={{
            ...toneSurface(theme, 'warning'),
            display: 'flex', alignItems: 'flex-start', gap: 1, mt: 2, px: 1.5, py: 1,
            border: '1px solid', borderRadius: INNER_RADIUS,
          }}
        >
          <Box component="span" aria-hidden sx={{ display: 'inline-flex', mt: '0.1em', flexShrink: 0 }}>
            <AppIcon icon={AlertTriangle} size="inline" />
          </Box>
          <Typography variant="body2" sx={{ color: 'inherit', fontWeight: 500 }}>{t.enabledMissingGroups}</Typography>
        </Box>
      )}
    </Box>
  );
}

interface TextModeProps {
  value: MonitorTextMode;
  onChange: (mode: MonitorTextMode) => void;
  describedBy: string;
}

/**
 * Seletor do modo de texto em cartões (`radiogroup`): tab entra no selecionado, setas/Home/End
 * mudam a seleção e o foco (WAI-ARIA). Selecionado = borda 2 px primary, tinta e selo de check.
 */
export function TextModeCards({ value, onChange, describedBy }: TextModeProps) {
  const theme = useTheme();
  const refs = useRef<Partial<Record<MonitorTextMode, HTMLButtonElement | null>>>({});
  const { primary } = theme.palette;

  const onKeyDown = (e: KeyboardEvent) => {
    const next = textModeForKey(value, e.key);
    if (!next) return;
    e.preventDefault();
    onChange(next);
    refs.current[next]?.focus();
  };

  return (
    <Box
      role="radiogroup"
      aria-label={t.textModeAria}
      aria-describedby={describedBy}
      onKeyDown={onKeyDown}
      sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' } }}
    >
      {TEXT_MODES.map((mode) => {
        const selected = mode === value;
        const m = t.textModes[mode];
        return (
          <ButtonBase
            key={mode}
            ref={(el: HTMLButtonElement | null) => { refs.current[mode] = el; }}
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            focusRipple
            onClick={() => onChange(mode)}
            sx={{
              position: 'relative',
              display: 'flex',
              flexDirection: { xs: 'row', sm: 'column' },
              alignItems: { xs: 'center', sm: 'flex-start' },
              justifyContent: 'flex-start',
              gap: 1.25,
              p: 1.75,
              pr: { xs: 5, sm: 1.75 },
              minHeight: 56,
              textAlign: 'left',
              borderRadius: INNER_RADIUS,
              border: '2px solid',
              borderColor: selected ? 'primary.main' : 'divider',
              bgcolor: selected ? alpha(primary.main, 0.08) : 'transparent',
              boxShadow: selected ? floatShadow(theme) : 'none',
              transition: theme.transitions.create(['border-color', 'background-color', 'box-shadow'], { duration: 200 }),
              '&:hover': { borderColor: selected ? 'primary.main' : alpha(primary.main, 0.45), bgcolor: selected ? alpha(primary.main, 0.1) : 'action.hover' },
              '&.Mui-focusVisible': { outline: `3px solid ${primary.main}`, outlineOffset: 3 },
              [REDUCED_MOTION]: { transition: 'none' },
            }}
          >
            <Box sx={iconTileSx(theme, selected ? 'primary' : 'neutral')}>
              <AppIcon icon={TEXT_MODE_ICONS[mode]} size="md" />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" component="span" sx={{ display: 'block', fontWeight: 700, lineHeight: 1.3, color: selected ? toneText(theme, 'primary') : 'text.primary' }}>
                {m.label}
              </Typography>
              <Typography variant="caption" component="span" color="text.secondary" sx={{ display: 'block', lineHeight: 1.4, mt: 0.25 }}>
                {m.short}
              </Typography>
            </Box>
            {selected && (
              <Box
                aria-hidden
                sx={{
                  position: 'absolute', top: 10, right: 10, width: 22, height: 22, borderRadius: '50%',
                  display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: 'primary.contrastText',
                }}
              >
                <AppIcon icon={Check} size="sm" strokeWidth={3} />
              </Box>
            )}
          </ButtonBase>
        );
      })}
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
  const theme = useTheme();
  const textHelpId = useId();
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
  const mentionAllEnabled = config.limits.mentionAllEnabled;
  const value = draft ?? settingsToDraft(config.settings);
  // Comparação e envio no valor efetivo: "mencionar todos" travado pelo plano não gera "não salvo" fantasma
  const dirty = isDraftDirty(draft, config.settings, mentionAllEnabled);
  const windowValid = isWindowValid(value.window);
  const fullDay = isFullDay(value.window);
  const missingGroups = config.monitoredGroups.length === 0 || config.broadcastGroups.length === 0;

  const patch = (p: Partial<MonitorSettingsDraft>) => setDraft({ ...value, ...p });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const sent = draft;
      await onSave(draftToSettings(effectiveDraft(value, mentionAllEnabled)));
      if (draftRef.current === sent) clearDraft();
      setSavedToast(true);
    } catch (err) {
      setError(uiErrorMessage(err, { scope: 'settings' }));
    } finally {
      setSaving(false);
    }
  };

  const minutes = (n: number) => t.minutes(n);
  const showBar = dirty || Boolean(error);

  return (
    <Stack spacing={3}>
      <MasterToggleCard enabled={value.enabled} missingGroups={missingGroups} onChange={(enabled) => patch({ enabled })} />

      <MonitorCard icon={Clock} title={t.windowTitle} subtitle={t.windowSubtitle}>
        <Stack spacing={2}>
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
      </MonitorCard>

      <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'repeat(2, minmax(0, 1fr))' } }}>
        <MonitorCard icon={Timer} tone="info" title={t.dispatchTitle} subtitle={t.dispatchSubtitle}>
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
        </MonitorCard>

        <MonitorCard icon={Hourglass} tone="info" title={t.afterTitle} subtitle={t.afterSubtitle}>
          <Stack spacing={2.5}>
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
            <Note>{t.afterHelp}</Note>
          </Stack>
        </MonitorCard>
      </Box>

      <MonitorCard icon={FileText} title={t.textTitle} subtitle={t.textSubtitle}>
        <Stack spacing={2}>
          <TextModeCards value={value.textMode} onChange={(textMode) => patch({ textMode })} describedBy={textHelpId} />
          <Typography id={textHelpId} variant="body2" color="text.secondary">{t.textModes[value.textMode].help}</Typography>
          {value.textMode === 'AI' && (
            <AudiencePicker value={value.audience} onChange={(audience) => patch({ audience })} label={t.audienceLabel} />
          )}
          <ToggleOption
            checked={value.enrichLinkOnly}
            onChange={(enrichLinkOnly) => patch({ enrichLinkOnly })}
            title={t.enrichTitle}
            description={t.enrichHelp}
          />
          <Note>{t.textProductNote}</Note>
          <Box
            sx={{
              display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', pt: 1.5,
              borderTop: '1px solid', borderColor: 'divider', color: 'text.secondary',
            }}
          >
            <Box component="span" aria-hidden sx={{ display: 'inline-flex' }}>
              <AppIcon icon={ImagePlus} size="sm" />
            </Box>
            <Chip size="small" variant="outlined" color="primary" label={t.soon} />
            <Typography variant="caption" component="p" sx={{ flex: 1, minWidth: 0 }}>{t.upcomingInline}</Typography>
          </Box>
        </Stack>
      </MonitorCard>

      {/* Região viva sempre montada: a barra que entra nela é anunciada (leitor de tela) */}
      <Box
        aria-live="polite"
        sx={{
          position: 'sticky',
          bottom: 'calc(16px + env(safe-area-inset-bottom))',
          zIndex: theme.zIndex.appBar - 1,
          mt: showBar ? undefined : '0 !important',
        }}
      >
        {showBar && (
          <Paper
            elevation={0}
            sx={{
              ...glassPillSx(theme),
              display: 'flex',
              flexWrap: 'wrap',
              whiteSpace: 'normal',
              gap: 1.5,
              px: { xs: 1.5, sm: 2 },
              py: 1.25,
              borderRadius: '16px',
              typography: 'body2',
              boxShadow: floatShadow(theme, true),
            }}
          >
            <Typography
              role={error ? 'alert' : 'status'}
              variant="body2"
              sx={{
                flex: 1, minWidth: 160, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1,
                color: error ? toneText(theme, 'error') : 'text.primary',
              }}
            >
              <Box
                component="span"
                aria-hidden
                sx={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: error ? 'error.main' : 'warning.main' }}
              />
              {error ?? t.unsaved}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ ml: 'auto' }}>
              <Button onClick={() => { clearDraft(); setError(null); }} disabled={saving} color="inherit">{t.discard}</Button>
              <Button
                variant="contained"
                onClick={() => void save()}
                disabled={saving || !windowValid || !dirty}
                startIcon={saving ? <CircularProgress size={16} color="inherit" sx={SPINNER_REDUCED_MOTION_SX} /> : undefined}
              >
                {saving ? t.saving : t.save}
              </Button>
            </Stack>
          </Paper>
        )}
      </Box>

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
