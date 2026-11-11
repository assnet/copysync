import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, FormHelperText, Grid, IconButton, InputAdornment, Snackbar, Stack,
  TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { Info } from 'lucide-react';
import { AppIcon, RangeSlider, SectionCard } from '@/components';
import { WORKER_SETTINGS_LIMITS, diffSettings, draftToSettings, parseDraftNumber, validateSettingsDraft } from '../rules';
import { workersAdminStrings } from '../strings';
import type { WorkerScalerMode, WorkerScalingSettingsDraft, WorkerScalingSettingsField } from '../types';
import { useWorkerSettings } from '../useWorkerSettings';
import { SettingsConfirmDialog } from './SettingsConfirmDialog';

const s = workersAdminStrings.settings;
type NumericField = Exclude<WorkerScalingSettingsField, 'scalerMode'>;

const LIMIT_FIELDS: NumericField[] = ['maxSessionsPerWorker', 'maxPendingLoginsPerWorker', 'alertOccupancyRatio', 'awaitingAlertSeconds'];
const TIMING_FIELDS: NumericField[] = ['scaleUpSustainSeconds', 'scaleCooldownSeconds'];
const MODES: WorkerScalerMode[] = ['off', 'manual', 'auto'];

function HelpTip({ field }: { field: WorkerScalingSettingsField }) {
  const f = s.fields[field];
  return (
    <Tooltip title={f.help}>
      <IconButton size="small" aria-label={s.helpAria(f.label)} edge="end">
        <AppIcon icon={Info} size="sm" />
      </IconButton>
    </Tooltip>
  );
}

/** Aba Configuração (WSCALE-07): formulário, confirmação com diff e rascunho persistido. */
export default function SettingsTab() {
  const w = useWorkerSettings();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const errors = useMemo(
    () => (w.values ? { ...validateSettingsDraft(w.values), ...w.serverErrors } : {}),
    [w.values, w.serverErrors],
  );
  const valid = Object.keys(errors).length === 0;
  const next = w.values && valid ? draftToSettings(w.values) : null;
  const changes = next && w.view ? diffSettings(w.view.settings, next) : [];

  if (w.loading && !w.view) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress aria-label={s.loading} />
      </Box>
    );
  }
  if (w.loadError || !w.view || !w.values) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void w.reload()}>{s.actions.retry}</Button>}>
        {w.loadError ?? s.errors.loadFailed}
      </Alert>
    );
  }

  const { view, values } = w;
  const cap = parseDraftNumber(values.maxSessionsPerWorker, true);
  // Sem adoção o teto não vale; a faixa "sem efeito" já cobre o caso.
  const belowOccupancy = view.enforced && cap !== null && w.busiest !== null && cap < w.busiest ? s.belowOccupancy(cap, w.busiest) : null;
  const capChange = changes.find((c) => c.field === 'maxSessionsPerWorker');
  // P1: sem medição de memória por sessão, toda mudança de teto pede o valor digitado.
  const strongValue = capChange ? (capChange.to as number) : null;

  const numberField = (field: NumericField) => {
    const f = s.fields[field];
    const err = errors[field];
    return (
      <TextField
        key={field}
        label={f.label}
        value={String(values[field])}
        onChange={(e) => w.change({ [field]: e.target.value } as Partial<WorkerScalingSettingsDraft>)}
        error={Boolean(err)}
        helperText={err ?? `${f.range} · ${s.origin[view.origin[field]]}`}
        fullWidth
        inputProps={{ inputMode: WORKER_SETTINGS_LIMITS[field].integer ? 'numeric' : 'decimal' }}
        InputProps={{ endAdornment: <InputAdornment position="end"><HelpTip field={field} /></InputAdornment> }}
      />
    );
  };

  const lim = WORKER_SETTINGS_LIMITS.minReplicas;
  const lo = parseDraftNumber(values.minReplicas, true) ?? view.settings.minReplicas;
  const hi = parseDraftNumber(values.maxReplicas, true) ?? view.settings.maxReplicas;
  const replicasError = errors.minReplicas ?? errors.maxReplicas;

  const onConfirm = async () => {
    if (!next) return;
    // Fecha em qualquer desfecho: 400 marca o campo, 409 recarrega; o resultado vai no Snackbar.
    await w.save(next);
    setConfirmOpen(false);
  };

  return (
    <Stack spacing={2}>
      {!view.enforced && <Alert severity="info">{s.notEnforced}</Alert>}

      <SectionCard title={s.groups.limits.title} subtitle={s.groups.limits.subtitle}>
        <Grid container spacing={2}>
          {LIMIT_FIELDS.map((field) => (
            <Grid item xs={12} md={6} key={field}>{numberField(field)}</Grid>
          ))}
        </Grid>
        {belowOccupancy && <Alert severity="warning" sx={{ mt: 2 }}>{belowOccupancy}</Alert>}
      </SectionCard>

      <SectionCard
        title={s.groups.scaling.title}
        subtitle={s.groups.scaling.subtitle}
        action={<Chip size="small" variant="outlined" label={s.groups.scaling.pending} />}
      >
        <Stack spacing={3}>
          <Box>
            <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1 }}>
              <Typography variant="subtitle2" id="worker-scaler-mode-label">{s.fields.scalerMode.label}</Typography>
              <HelpTip field="scalerMode" />
            </Stack>
            <ToggleButtonGroup
              exclusive
              size="small"
              color="primary"
              value={values.scalerMode}
              onChange={(_, mode: WorkerScalerMode | null) => { if (mode) w.change({ scalerMode: mode }); }}
              aria-labelledby="worker-scaler-mode-label"
              aria-describedby="worker-scaler-mode-help"
              sx={{ flexWrap: 'wrap' }}
            >
              {MODES.map((m) => <ToggleButton key={m} value={m} sx={{ px: 2 }}>{s.scalerModes[m]}</ToggleButton>)}
            </ToggleButtonGroup>
            <FormHelperText id="worker-scaler-mode-help" error={Boolean(errors.scalerMode)}>
              {errors.scalerMode ?? s.origin[view.origin.scalerMode]}
            </FormHelperText>
          </Box>

          <Box>
            <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1 }}>
              <Typography variant="subtitle2">{s.replicas.label}</Typography>
              <Tooltip title={s.replicas.help}>
                <IconButton size="small" aria-label={s.helpAria(s.replicas.label)}>
                  <AppIcon icon={Info} size="sm" />
                </IconButton>
              </Tooltip>
            </Stack>
            <RangeSlider
              value={[lo, hi]}
              onChange={([a, b]) => w.change({ minReplicas: a, maxReplicas: b })}
              min={lim.min}
              max={lim.max}
              ariaLabel={s.replicas.aria}
              minLabel={s.replicas.min}
              maxLabel={s.replicas.max}
              formatValue={s.replicas.value}
              error={Boolean(replicasError)}
              describedBy="worker-replicas-help"
            />
            <FormHelperText id="worker-replicas-help" error={Boolean(replicasError)}>
              {replicasError ?? `${s.fields.minReplicas.range} · ${s.origin[view.origin.minReplicas]}`}
            </FormHelperText>
          </Box>

          <Grid container spacing={2}>
            {TIMING_FIELDS.map((field) => (
              <Grid item xs={12} md={6} key={field}>{numberField(field)}</Grid>
            ))}
          </Grid>
        </Stack>
      </SectionCard>

      <Stack
        direction={{ xs: 'column-reverse', sm: 'row' }}
        spacing={1.5}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        justifyContent="space-between"
      >
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="body2" color="text.secondary">
            {view.updatedAt ? s.lastSaved(new Date(view.updatedAt).toLocaleString('pt-BR')) : s.neverSaved}
          </Typography>
          {w.restored && <Chip size="small" label={s.draftRestored} variant="outlined" />}
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          {w.dirty && <Button onClick={w.discard} disabled={w.saving}>{s.actions.discard}</Button>}
          <Button variant="contained" onClick={() => setConfirmOpen(true)} disabled={!valid || changes.length === 0 || w.saving}>
            {s.actions.review}
          </Button>
        </Stack>
      </Stack>

      <SettingsConfirmDialog
        open={confirmOpen}
        changes={changes}
        strongValue={strongValue}
        warning={belowOccupancy}
        saving={w.saving}
        onConfirm={() => void onConfirm()}
        onClose={() => setConfirmOpen(false)}
      />

      <Snackbar open={Boolean(w.notice)} autoHideDuration={6000} onClose={w.clearNotice} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {w.notice ? <Alert severity={w.notice.severity} variant="filled" onClose={w.clearNotice}>{w.notice.text}</Alert> : <span />}
      </Snackbar>
    </Stack>
  );
}
