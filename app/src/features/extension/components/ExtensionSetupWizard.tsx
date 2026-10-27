import { useState, useEffect, useCallback } from 'react';
import {
  Box, Stepper, Step, StepLabel, Typography, Button, Checkbox,
  FormControlLabel, Alert, CircularProgress, Link,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { useExtension, syncErrorMessage } from '../hooks/useExtension';
import { extensionStrings } from '../strings';

const t = extensionStrings.wizard;

interface Props {
  onComplete: () => void;
}

const STEPS = [t.stepDetect, t.stepConnect, t.stepSync, t.stepDone];

export function ExtensionSetupWizard({ onComplete }: Props) {
  const ext = useExtension();
  const [step, setStep] = useState(0);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 0: auto-detect
  useEffect(() => {
    if (step !== 0) return;
    if (ext.loading) return;
    if (ext.status === 'connected') {
      setStep(2);
    } else if (ext.status === 'detected') {
      setStep(1);
    }
  }, [step, ext.loading, ext.status]);

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
      setStep(2);
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
      setStep(3);
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

      {/* Step 0 — Detect */}
      {step === 0 && (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          {ext.loading ? (
            <>
              <CircularProgress sx={{ mb: 2 }} />
              <Typography>{t.detectTitle}</Typography>
            </>
          ) : ext.status === 'not_detected' || ext.status === 'unavailable' ? (
            <Alert severity="warning" variant="outlined">
              <Typography fontWeight={600} gutterBottom>{t.detectNotFound}</Typography>
              <Typography variant="body2">{t.detectNotFoundHint}</Typography>
            </Alert>
          ) : null}
        </Box>
      )}

      {/* Step 1 — Connect */}
      {step === 1 && (
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

      {/* Step 2 — Sync */}
      {step === 2 && (
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
              onClick={() => setStep(3)}
            >
              {t.syncSkip}
            </Link>
          </Box>
        </Box>
      )}

      {/* Step 3 — Done */}
      {step === 3 && (
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
