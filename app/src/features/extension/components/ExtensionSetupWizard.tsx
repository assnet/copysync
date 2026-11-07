import { useState, useEffect, useCallback } from 'react';
import {
  Box, Stepper, Step, StepLabel, Typography, Button, Checkbox,
  FormControlLabel, Alert, CircularProgress, Link,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { useExtension, syncErrorMessage } from '../hooks/useExtension';
import { extensionStrings } from '../strings';
import type { ExtensionInstallSource } from '../config';
import { ExtensionInstallPanel } from './ExtensionInstallPanel';

const t = extensionStrings.wizard;

interface Props {
  onComplete: () => void;
  /** Tela que hospeda o assistente (métrica do clique em "Instalar"). */
  source?: ExtensionInstallSource;
}

const STEPS = [t.stepInstall, t.stepDetect, t.stepConnect, t.stepSync, t.stepDone];
const STEP = { install: 0, detect: 1, connect: 2, sync: 3, done: 4 } as const;

export function ExtensionSetupWizard({ onComplete, source = 'settings' }: Props) {
  const ext = useExtension();
  const { refresh } = ext;
  const [step, setStep] = useState<number>(STEP.install);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Instalar/Detectar: já detectada pula direto para o vínculo (ou sync, se já vinculada)
  useEffect(() => {
    if (step > STEP.detect || ext.loading) return;
    if (ext.status === 'connected') {
      setStep(STEP.sync);
    } else if (ext.status === 'detected') {
      setStep(STEP.connect);
    }
  }, [step, ext.loading, ext.status]);

  // O painel de instalação viu a extensão: handshake completo antes de avançar
  const handleDetected = useCallback(() => {
    setStep(STEP.detect);
    void refresh();
  }, [refresh]);

  const handleConnect = useCallback(async () => {
    if (!ext.handshake) return;
    setBusy(true);
    setError(null);
    try {
      await ext.connect(
        ext.handshake.installationId ?? crypto.randomUUID(),
        ext.handshake.extVersion,
        consent,
      );
      setStep(STEP.sync);
    } catch {
      setError(extensionStrings.errors.connectionFailed);
    } finally {
      setBusy(false);
    }
  }, [ext, consent]);

  const handleSync = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await ext.syncMl();
      setStep(STEP.done);
    } catch (err) {
      setError(syncErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [ext]);

  return (
    <Box>
      <Stepper activeStep={step} alternativeLabel sx={{ mb: 4 }}>
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Instalar */}
      {step === STEP.install && (
        ext.loading ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <CircularProgress sx={{ mb: 2 }} />
            <Typography>{t.detectTitle}</Typography>
          </Box>
        ) : ext.status === 'error' ? (
          <Alert severity="warning" variant="outlined">{extensionStrings.errors.extensionNotResponding}</Alert>
        ) : ext.status === 'not_detected' || ext.status === 'unavailable' ? (
          <ExtensionInstallPanel source={source} onDetected={handleDetected} />
        ) : null
      )}

      {/* Detectar */}
      {step === STEP.detect && (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          {ext.loading ? (
            <>
              <CircularProgress sx={{ mb: 2 }} />
              <Typography>{t.detectTitle}</Typography>
            </>
          ) : ext.status === 'not_detected' || ext.status === 'unavailable' || ext.status === 'error' ? (
            <Alert
              severity="warning"
              variant="outlined"
              action={(
                <Button color="inherit" size="small" onClick={() => setStep(STEP.install)}>{t.detectRetry}</Button>
              )}
            >
              <Typography fontWeight={600} gutterBottom>{t.detectNotFound}</Typography>
              <Typography variant="body2">{extensionStrings.errors.extensionNotResponding}</Typography>
            </Alert>
          ) : null}
        </Box>
      )}

      {/* Vincular */}
      {step === STEP.connect && (
        <Box sx={{ py: 2 }}>
          <Typography variant="h6" gutterBottom>{t.connectTitle}</Typography>
          {ext.handshake && (
            <Typography variant="body2" color="text.secondary" mb={2}>
              {t.detectFoundHint}{ext.handshake.extVersion}
            </Typography>
          )}
          <FormControlLabel
            control={<Checkbox checked={consent} onChange={(_, v) => setConsent(v)} />}
            label={t.connectConsent}
            sx={{ mb: 3, display: 'flex', alignItems: 'flex-start', '& .MuiCheckbox-root': { mt: -0.5 } }}
          />
          <Button
            variant="contained"
            disableElevation
            disabled={!consent || busy}
            onClick={() => void handleConnect()}
          >
            {busy ? t.connectingAction : t.connectAction}
          </Button>
        </Box>
      )}

      {/* Sincronizar */}
      {step === STEP.sync && (
        <Box sx={{ py: 2 }}>
          <Typography variant="h6" gutterBottom>{t.syncTitle}</Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            {t.syncHint}
          </Typography>
          {ext.mlStatus && !ext.mlStatus.loggedIn && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {extensionStrings.ml.statusLoggedOut}
            </Alert>
          )}
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <Button
              variant="contained"
              disableElevation
              disabled={busy}
              onClick={() => void handleSync()}
            >
              {busy ? t.syncingAction : t.syncAction}
            </Button>
            <Link
              component="button"
              variant="body2"
              underline="hover"
              onClick={() => setStep(STEP.done)}
            >
              {t.syncSkip}
            </Link>
          </Box>
        </Box>
      )}

      {/* Pronto */}
      {step === STEP.done && (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <CheckCircleOutlineIcon color="success" sx={{ fontSize: 48, mb: 1 }} />
          <Typography variant="h6" gutterBottom>{t.doneTitle}</Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            {t.doneHint}
          </Typography>
          <Button variant="contained" disableElevation onClick={onComplete}>
            {t.doneAction}
          </Button>
        </Box>
      )}
    </Box>
  );
}
