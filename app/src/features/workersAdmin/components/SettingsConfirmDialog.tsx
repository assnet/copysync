import { useEffect, useState } from 'react';
import {
  Alert, AlertTitle, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { workersAdminStrings } from '../strings';
import type { WorkerScalingSettings, WorkerScalingSettingsChange, WorkerScalingSettingsField } from '../types';

const s = workersAdminStrings.settings;

/** Valor exibido de um campo (modo pelo rótulo; números no formato pt-BR). */
export function formatSettingValue(field: WorkerScalingSettingsField, value: WorkerScalingSettings[WorkerScalingSettingsField]): string {
  if (field === 'scalerMode') return s.scalerModes[value as WorkerScalingSettings['scalerMode']] ?? String(value);
  return typeof value === 'number' ? value.toLocaleString('pt-BR') : String(value);
}

interface Props {
  open: boolean;
  changes: WorkerScalingSettingsChange[];
  /** Teto novo a digitar para liberar o botão; `null` = sem confirmação reforçada. */
  strongValue: number | null;
  /** `true` = o teto sobe (risco de memória); `false` = reduz (só para de adotar). */
  strongRaise?: boolean;
  /** Teto sugerido pela medição; com valor, o aviso reforçado fala em passar do sugerido. */
  suggestedMaxSessions?: number | null;
  /** Aviso de teto abaixo da ocupação atual. */
  warning?: string | null;
  saving: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Diálogo da feature: mostra o diff e, se o teto muda sem medição, pede o valor digitado. */
export function SettingsConfirmDialog({ open, changes, strongValue, strongRaise = true, suggestedMaxSessions = null, warning, saving, onConfirm, onClose }: Props) {
  const [typed, setTyped] = useState('');
  useEffect(() => { if (open) setTyped(''); }, [open]);

  const expected = strongValue === null ? '' : String(strongValue);
  const confirmed = strongValue === null || typed.trim() === expected;

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="worker-settings-confirm-title">
      <DialogTitle id="worker-settings-confirm-title" sx={{ fontWeight: 700 }}>{s.confirm.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">{s.confirm.intro}</Typography>
          <Table size="small" aria-label={s.confirm.title}>
            <TableHead>
              <TableRow>
                <TableCell>{s.confirm.field}</TableCell>
                <TableCell align="right">{s.confirm.before}</TableCell>
                <TableCell align="right">{s.confirm.after}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {changes.map((c) => (
                <TableRow key={c.field}>
                  <TableCell>{s.fields[c.field].label}</TableCell>
                  <TableCell align="right" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                    {formatSettingValue(c.field, c.from)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {formatSettingValue(c.field, c.to)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {warning && <Alert severity="warning">{warning}</Alert>}
          {strongValue !== null && (
            <Alert severity="warning" icon={false}>
              <AlertTitle>{suggestedMaxSessions !== null ? s.confirm.strongTitleAbove : s.confirm.strongTitle}</AlertTitle>
              <Typography variant="body2" sx={{ mb: 1.5 }}>
                {suggestedMaxSessions !== null
                  ? s.confirm.strongHintAbove(suggestedMaxSessions.toLocaleString('pt-BR'))
                  : strongRaise ? s.confirm.strongHintRaise : s.confirm.strongHintLower}
              </Typography>
              <TextField
                label={s.confirm.strongLabel}
                helperText={s.confirm.strongHelper(expected)}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                size="small"
                fullWidth
                autoComplete="off"
                inputProps={{ inputMode: 'numeric' }}
              />
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>{s.confirm.cancel}</Button>
        <Button variant="contained" onClick={onConfirm} disabled={saving || !confirmed}>
          {saving ? s.confirm.saving : s.confirm.save}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
