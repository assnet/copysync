import { useEffect, useState } from 'react';
import {
  Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
  IconButton, Stack, Tooltip, Typography,
} from '@mui/material';
import { TriangleAlert, X } from 'lucide-react';
import { AppIcon } from '@/components';
import { settingsStrings } from '../strings';

const t = settingsStrings.affiliate.riskNotice;

interface Props {
  open: boolean;
  /** Só administrador do tenant aceita; operador lê com o botão desabilitado. */
  canAccept: boolean;
  /** Rótulo do botão: "Aceitar e conectar" no fluxo de conexão, "Aceitar aviso" no reaceite. */
  confirmLabel?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Texto completo do aviso de risco com a caixa "Li e assumo o risco", desmarcada a cada abertura.
 * A caixa NÃO usa `usePersistedState` (exceção à regra de persistência): o aceite nunca pode
 * sobreviver a um reload sem um clique novo.
 */
export function MarketplaceRiskNoticeDialog({ open, canAccept, confirmLabel, busy, error, onConfirm, onClose }: Props) {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (open) setChecked(false);
  }, [open]);

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="risk-notice-title">
      <DialogTitle
        id="risk-notice-title"
        sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1, pr: 1.5 }}
      >
        <Stack component="span" sx={{ color: 'warning.main', display: 'inline-flex' }}>
          <AppIcon icon={TriangleAlert} size="md" />
        </Stack>
        <Stack component="span" sx={{ flexGrow: 1 }}>{t.dialogTitle}</Stack>
        <Tooltip title={t.cancel}>
          <span>
            <IconButton onClick={onClose} size="small" aria-label={t.cancel} disabled={busy}>
              <AppIcon icon={X} size="md" />
            </IconButton>
          </span>
        </Tooltip>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={1.5} component="section" aria-label={t.dialogTitle}>
          {t.paragraphs.map((p) => (
            <Typography key={p} variant="body2">{p}</Typography>
          ))}
        </Stack>

        <FormControlLabel
          sx={{ mt: 2.5, alignItems: 'flex-start', '& .MuiCheckbox-root': { mt: -0.75 } }}
          control={(
            <Checkbox
              checked={checked}
              onChange={(_, v) => setChecked(v)}
              disabled={!canAccept || busy}
            />
          )}
          label={<Typography variant="body2" fontWeight={600}>{t.checkbox}</Typography>}
        />

        {!canAccept && (
          <Alert severity="info" variant="outlined" sx={{ mt: 1.5 }}>{t.adminOnly}</Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={busy}>{t.cancel}</Button>
        <Tooltip title={canAccept ? '' : t.adminOnly}>
          <span>
            <Button
              variant="contained"
              color="warning"
              disableElevation
              disabled={!canAccept || !checked || busy}
              onClick={onConfirm}
            >
              {busy ? t.confirming : (confirmLabel ?? t.confirm)}
            </Button>
          </span>
        </Tooltip>
      </DialogActions>
    </Dialog>
  );
}
