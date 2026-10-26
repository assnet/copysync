import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogActions, Box, Button, TextField, Typography, Alert,
  Stepper, Step, StepLabel, IconButton, Tooltip, CircularProgress, Divider,
  useMediaQuery, useTheme, alpha,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import InfoIcon from '@mui/icons-material/InfoOutlined';
import { sessionService } from '@/services/session.service';
import type { SessionItem, SessionStatus } from '@/types/api.types';
import { sessionStrings } from '../strings';
import {
  normalizeBrazilPhone, formatBrazilPhone, isValidSessionName, SESSION_NAME_MAX,
} from '../utils';
import { useSessionConnection } from '../hooks/useSessionConnection';
import { SessionConnectPanel } from './SessionConnectPanel';
import { SessionConnectedPanel } from './SessionConnectedPanel';

const t = sessionStrings.wizard;

interface Props {
  open: boolean;
  onClose: () => void;
  /** Sessão criada (o assistente continua aberto para conectar). */
  onCreated: (session: SessionItem) => void;
  onStatusChange?: (sessionId: string, status: SessionStatus) => void;
}

type ApiError = Error & { code?: string; field?: string };

/** Assistente em 4 passos: número → nome → conectar → pronto. */
export function CreateSessionWizard({ open, onClose, onCreated, onStatusChange }: Props) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [step, setStep] = useState(0);
  const [phoneInput, setPhoneInput] = useState('');
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const conn = useSessionConnection({ sessionId, enabled: open && step >= 2, onStatusChange });
  const normalized = normalizeBrazilPhone(phoneInput);
  const nameOk = isValidSessionName(name);

  useEffect(() => {
    if (conn.isConnected && step === 2) setStep(3);
  }, [conn.isConnected, step]);

  useEffect(() => {
    if (open) return;
    setStep(0); setPhoneInput(''); setPhoneTouched(false); setPhoneError(null);
    setName(''); setNameTouched(false); setCreating(false); setCreateError(null); setSessionId(null);
  }, [open]);

  function goToName() {
    setPhoneTouched(true);
    if (normalized) { setPhoneError(null); setStep(1); }
  }

  async function createAndConnect() {
    setNameTouched(true);
    if (!nameOk || !normalized || creating) return;
    setCreating(true); setCreateError(null);
    let created: SessionItem;
    try {
      created = await sessionService.create({ name: name.trim(), declaredPhone: normalized });
    } catch (err) {
      const e = err as ApiError;
      if (e.code === 'SESSION_PHONE_INVALID' || e.field === 'declaredPhone') {
        setPhoneError(t.phone.rejected);
        setStep(0);
      } else {
        setCreateError(e.message || t.createError);
      }
      setCreating(false);
      return;
    }
    onCreated(created);
    setSessionId(created.id);
    try {
      const res = await sessionService.connect(created.id);
      onStatusChange?.(created.id, res.status);
    } catch {
      // A sessão existe; o passo 3 mostra "Gerar novo código" para tentar de novo.
    }
    setCreating(false);
    setStep(2);
  }

  const handleClose = () => { if (!creating) onClose(); };

  const phoneInvalid = phoneTouched && !normalized;
  const nameInvalid = nameTouched && !nameOk;

  return (
    <Dialog open={open} onClose={handleClose} fullScreen={fullScreen} maxWidth="sm" fullWidth>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 3, pt: 2.5, pb: 1 }}>
        <Typography variant="h6" component="h1" fontWeight={700}>{t.title}</Typography>
        <Tooltip title={t.close}>
          <span>
            <IconButton onClick={handleClose} disabled={creating} aria-label={t.close}>
              <CloseIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Box sx={{ px: { xs: 1, sm: 3 }, pb: 2 }}>
        <Stepper activeStep={step} alternativeLabel>
          {t.steps.map((label, i) => (
            <Step key={label} completed={step > i || (i === 3 && step === 3)}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      </Box>

      <Divider />

      <DialogContent sx={{ px: 3, py: 3 }}>
        {step === 0 && (
          <Box
            component="form"
            noValidate
            onSubmit={(e) => { e.preventDefault(); goToName(); }}
            id="session-phone-form"
            sx={{ display: 'grid', gap: 2.5 }}
          >
            <Typography variant="h6" component="h2" fontWeight={700}>{t.phone.title}</Typography>
            <Box
              sx={{
                display: 'flex', gap: 1.5, p: 2, borderRadius: 2,
                bgcolor: alpha(theme.palette.info.main, 0.08),
                border: '1px solid', borderColor: alpha(theme.palette.info.main, 0.25),
              }}
            >
              <InfoIcon sx={{ color: 'info.main', mt: 0.25 }} aria-hidden />
              <Box>
                <Typography variant="subtitle2">{t.phone.howToTitle}</Typography>
                <Typography variant="body2" color="text.secondary">{t.phone.howToBody}</Typography>
                <Typography variant="body2" color="text.secondary">{t.phone.howToFormat}</Typography>
              </Box>
            </Box>
            <TextField
              label={t.phone.label}
              value={phoneInput}
              onChange={(e) => {
                setPhoneInput(e.target.value.replace(/[^\d\s()+-]/g, '').slice(0, 20));
                setPhoneError(null);
              }}
              onBlur={() => setPhoneTouched(true)}
              placeholder={t.phone.placeholder}
              autoFocus
              fullWidth
              autoComplete="tel-national"
              inputProps={{ inputMode: 'tel' }}
              error={phoneInvalid || Boolean(phoneError)}
              helperText={
                phoneError ?? (phoneInvalid ? t.phone.invalid
                  : normalized ? t.phone.preview(formatBrazilPhone(normalized)) : ' ')
              }
            />
          </Box>
        )}

        {step === 1 && (
          <Box
            component="form"
            noValidate
            onSubmit={(e) => { e.preventDefault(); void createAndConnect(); }}
            id="session-name-form"
            sx={{ display: 'grid', gap: 2.5 }}
          >
            <Typography variant="h6" component="h2" fontWeight={700}>{t.name.title}</Typography>
            {createError && <Alert severity="error">{createError}</Alert>}
            <TextField
              label={t.name.label}
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, SESSION_NAME_MAX))}
              onBlur={() => setNameTouched(true)}
              placeholder={t.name.placeholder}
              autoFocus
              fullWidth
              disabled={creating}
              error={nameInvalid}
              helperText={nameInvalid ? t.name.tooShort : t.name.helper}
              InputProps={{
                endAdornment: (
                  <Typography variant="caption" color="text.disabled" sx={{ whiteSpace: 'nowrap' }}>
                    {t.name.counter(name.length, SESSION_NAME_MAX)}
                  </Typography>
                ),
              }}
            />
          </Box>
        )}

        {step === 2 && <SessionConnectPanel conn={conn} />}
        {step === 3 && <SessionConnectedPanel session={conn.session} />}
      </DialogContent>

      <Divider />

      <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
        {step === 0 && (
          <>
            <Button onClick={handleClose}>{t.cancel}</Button>
            <Button type="submit" form="session-phone-form" variant="contained">{t.next}</Button>
          </>
        )}
        {step === 1 && (
          <>
            <Button onClick={() => setStep(0)} disabled={creating}>{t.back}</Button>
            <Button
              type="submit"
              form="session-name-form"
              variant="contained"
              disabled={creating}
              startIcon={creating ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {t.name.submit}
            </Button>
          </>
        )}
        {step === 2 && <Button onClick={handleClose}>{t.close}</Button>}
        {step === 3 && <Button variant="contained" onClick={handleClose}>{t.finish}</Button>}
      </DialogActions>
    </Dialog>
  );
}
