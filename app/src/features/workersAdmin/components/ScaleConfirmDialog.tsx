import { useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography,
} from '@mui/material';
import { ArrowRight } from 'lucide-react';
import { AppIcon } from '@/components';
import { SCALE_REASON_MAX, scaleReasonError, scaleTargetError } from '../rules';
import { workersAdminStrings } from '../strings';
import type { WorkerScaleDraft } from '../useWorkerScale';

const d = workersAdminStrings.scale.dialog;

interface Props {
  draft: WorkerScaleDraft | null;
  /** Réplicas desejadas atuais. */
  current: number;
  min: number;
  max: number;
  sending: boolean;
  error: string | null;
  onChange: (patch: Partial<Pick<WorkerScaleDraft, 'replicas' | 'reason'>>) => void;
  onConfirm: () => void;
  onClose: () => void;
}

/** Diálogo próprio (o `ConfirmDialog` não tem campo): alvo dentro da faixa e motivo de 3 a 200 caracteres. */
export function ScaleConfirmDialog({ draft, current, min, max, sending, error, onChange, onConfirm, onClose }: Props) {
  const open = draft !== null;
  const [reasonTouched, setReasonTouched] = useState(false);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) setReasonTouched(false);
    wasOpen.current = open;
  }, [open]);

  const replicas = draft?.replicas ?? current;
  const reason = draft?.reason ?? '';
  const targetError = scaleTargetError(replicas, current, min, max);
  const reasonError = scaleReasonError(reason);
  const showReasonError = reasonError !== null && (reasonTouched || reason.length > 0);
  const target = Number(replicas);
  const isDown = targetError === null && target < current;
  const valid = targetError === null && reasonError === null;

  return (
    <Dialog
      open={open}
      onClose={sending ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="worker-scale-dialog-title"
    >
      <DialogTitle id="worker-scale-dialog-title" sx={{ fontWeight: 700 }}>{d.title}</DialogTitle>
      <DialogContent>
        <Stack
          component="form"
          id="worker-scale-form"
          spacing={2.5}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !sending) onConfirm();
          }}
        >
          <Typography variant="body2" color="text.secondary">{d.intro(current)}</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'flex-start' } }}>
            <TextField
              label={d.targetLabel}
              value={String(replicas)}
              onChange={(e) => onChange({ replicas: e.target.value })}
              error={targetError !== null}
              helperText={targetError ?? d.targetHelp(min, max)}
              size="small"
              autoComplete="off"
              disabled={sending}
              inputProps={{ inputMode: 'numeric' }}
              sx={{ width: { xs: '100%', sm: 180 } }}
            />
            {targetError === null && (
              <Box
                role="status"
                aria-label={d.change(current, target)}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1, height: 40, px: 1.5, borderRadius: 1,
                  bgcolor: 'action.hover', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                }}
              >
                <span>{current}</span>
                <AppIcon icon={ArrowRight} size="inline" aria-hidden />
                <span>{target}</span>
              </Box>
            )}
          </Stack>
          {isDown && <Alert severity="warning">{d.downWarning}</Alert>}
          <TextField
            label={d.reasonLabel}
            value={reason}
            onChange={(e) => onChange({ reason: e.target.value })}
            onBlur={() => setReasonTouched(true)}
            error={showReasonError}
            helperText={showReasonError ? reasonError : d.reasonHelp}
            required
            multiline
            minRows={2}
            fullWidth
            disabled={sending}
            inputProps={{ maxLength: SCALE_REASON_MAX + 50 }}
            InputProps={{
              endAdornment: (
                <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'flex-end', whiteSpace: 'nowrap', ml: 1 }}>
                  {d.reasonCount(reason.trim().length)}
                </Typography>
              ),
            }}
          />
          {error && <Alert severity="error" role="alert">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={sending}>{d.cancel}</Button>
        <Button variant="contained" type="submit" form="worker-scale-form" disabled={sending || !valid}>
          {sending ? d.sending : d.confirm}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
