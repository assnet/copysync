import { useEffect, useState } from 'react';
import {
  Alert, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
  IconButton, Stack, Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import { RotateCw, TriangleAlert, X } from 'lucide-react';
import { AppIcon } from '@/components';
import { offerHunterStrings, type HunterRiskProvider } from '../strings';
import { useHunterRiskAcceptance } from '../hooks';

const g = offerHunterStrings.gatesPanel;

export interface HunterRiskNoticeDialogProps {
  open: boolean;
  /** Marca do aviso: título, texto e versão próprios; o aceite vale só para ela. */
  provider: HunterRiskProvider;
  /** Papel ADMIN no tenant ativo ou super admin (a API aceita os dois no escopo `OFFER_HUNTER`). */
  canAccept: boolean;
  /** Super admin: aceite registrado com o id dele; texto avisa que vale para a conta inteira. */
  isSuperAdmin?: boolean;
  onClose: () => void;
  /** Aceite gravado: a tela recarrega `useHuntOptions` (portão `riskAccepted`). */
  onAccepted: () => void;
  /** 409 `MARKETPLACE_RISK_NOTICE_OUTDATED`: a tela recarrega as opções. */
  onStale?: () => void;
}

/**
 * Aviso de risco próprio do caçador (escopo `OFFER_HUNTER`). A caixa "Li e assumo o risco" nasce
 * desmarcada a cada abertura e NÃO usa `usePersistedState`: o aceite exige um clique novo após reload.
 */
export function HunterRiskNoticeDialog({ open, provider, canAccept, isSuperAdmin, onClose, onAccepted, onStale }: HunterRiskNoticeDialogProps) {
  const t = offerHunterStrings.riskNotice[provider];
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const { accept, accepting, errorCode, stale } = useHunterRiskAcceptance(provider);
  const [checked, setChecked] = useState(false);
  const allowed = canAccept;

  useEffect(() => {
    if (open) setChecked(false);
  }, [open, provider]);

  useEffect(() => {
    if (stale) onStale?.();
    // onStale só no momento em que a versão ficou velha
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale]);

  const handleConfirm = async () => {
    const res = await accept();
    if (res) onAccepted();
  };

  const errorText = errorCode && !stale
    ? (offerHunterStrings.errors[errorCode] ?? t.acceptFailed)
    : null;

  return (
    <Dialog
      open={open}
      onClose={accepting ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      fullScreen={fullScreen}
      aria-labelledby="hunter-risk-title"
    >
      <DialogTitle id="hunter-risk-title" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1, pr: 6 }}>
        <Stack component="span" sx={{ color: 'warning.main', display: 'inline-flex' }}>
          <AppIcon icon={TriangleAlert} size="md" />
        </Stack>
        <Stack component="span" sx={{ flexGrow: 1 }}>{t.dialogTitle}</Stack>
      </DialogTitle>
      <Tooltip title={t.close} describeChild>
        <span style={{ position: 'absolute', top: 12, right: 12 }}>
          <IconButton onClick={onClose} size="small" aria-label={t.close} disabled={accepting}>
            <AppIcon icon={X} size="md" />
          </IconButton>
        </span>
      </Tooltip>

      <DialogContent dividers>
        {stale && (
          <Alert
            severity="warning"
            sx={{ mb: 2 }}
            action={(
              <Tooltip title={t.reloadPageTooltip} describeChild>
                <Button color="inherit" size="small" startIcon={<AppIcon icon={RotateCw} size="sm" />} onClick={() => window.location.reload()}>
                  {t.reloadPage}
                </Button>
              </Tooltip>
            )}
          >
            <Typography variant="body2" fontWeight={600}>{t.staleTitle}</Typography>
            <Typography variant="body2">{g.staleReloaded}</Typography>
          </Alert>
        )}

        <Stack spacing={1.5} component="section" aria-label={t.dialogTitle}>
          {t.paragraphs.map((p) => <Typography key={p} variant="body2">{p}</Typography>)}
        </Stack>

        {!stale && (
          <FormControlLabel
            sx={{ mt: 2.5, alignItems: 'flex-start', '& .MuiCheckbox-root': { mt: -0.75 } }}
            control={(
              <Checkbox checked={checked} onChange={(_, v) => setChecked(v)} disabled={!allowed || accepting} />
            )}
            label={<Typography variant="body2" fontWeight={600}>{t.checkbox}</Typography>}
          />
        )}

        {allowed && isSuperAdmin && !stale && (
          <Alert severity="warning" variant="outlined" sx={{ mt: 1.5 }}>
            <Typography variant="body2">{g.superAdminAccepts}</Typography>
          </Alert>
        )}
        {!allowed && !stale && (
          <Alert severity="info" variant="outlined" sx={{ mt: 1.5 }}>
            <Typography variant="body2" fontWeight={600}>{t.adminOnly}</Typography>
            <Typography variant="body2">{g.askAdmin}</Typography>
          </Alert>
        )}
        {errorText && <Alert severity="error" sx={{ mt: 1.5 }} aria-live="polite">{errorText}</Alert>}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={accepting}>{stale ? t.close : t.cancel}</Button>
        {!stale && (
          <Tooltip title={allowed ? '' : t.adminOnly} describeChild>
            <span>
              <Button
                variant="contained"
                color="warning"
                disableElevation
                disabled={!allowed || !checked || accepting}
                startIcon={accepting ? <CircularProgress size={14} color="inherit" /> : undefined}
                onClick={() => void handleConfirm()}
              >
                {accepting ? t.confirming : t.confirm}
              </Button>
            </span>
          </Tooltip>
        )}
      </DialogActions>
    </Dialog>
  );
}
