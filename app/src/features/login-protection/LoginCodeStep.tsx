import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, TextField, Tooltip, Typography } from '@mui/material';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { AppIcon } from '@/components/AppIcon';
import { CooldownBar } from '@/components/CooldownBar';
import { serverNow } from '@/services/serverClock';
import { loginErrorMessage, sanitizeCode, type LoginCodeChallenge } from './loginProtection';
import { fill, loginProtectionStrings as S } from './strings';

export interface LoginCodeStepProps {
  email: string;
  challenge: LoginCodeChallenge;
  onVerify: (code: string) => Promise<void>;
  onResend: () => Promise<LoginCodeChallenge>;
  onBack: () => void;
  /** Erro que encerra o passo (ticket vencido): volta para e-mail e senha. */
  onExpired: (message: string) => void;
}

/**
 * Passo do código por e-mail no login suspeito. Um campo só (colar e `one-time-code` funcionam),
 * foco automático, erro junto do campo e reenvio com espera pela `CooldownBar` (relógio do servidor).
 * Ticket e código ficam só em memória.
 */
export function LoginCodeStep({ email, challenge, onVerify, onResend, onBack, onExpired }: LoginCodeStepProps) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'verify' | 'resend' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(challenge.resendAvailableAt);
  const [waitStart, setWaitStart] = useState(() => serverNow());
  const [canResend, setCanResend] = useState(() => Date.parse(challenge.resendAvailableAt) <= serverNow());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleError = (err: unknown) => {
    const c = (err as { code?: string })?.code;
    if (c === 'LOGIN_TICKET_INVALID') { onExpired(loginErrorMessage(err)); return; }
    setError(loginErrorMessage(err));
    if (c === 'LOGIN_CODE_INVALID') { setCode(''); inputRef.current?.focus(); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6 || busy) return;
    setBusy('verify'); setError(null); setInfo(null);
    try { await onVerify(code); } catch (err) { handleError(err); } finally { setBusy(null); }
  };

  const resend = async () => {
    setBusy('resend'); setError(null); setInfo(null);
    try {
      const next = await onResend();
      setResendAt(next.resendAvailableAt);
      setWaitStart(serverNow());
      setCanResend(Date.parse(next.resendAvailableAt) <= serverNow());
      setCode('');
      setInfo(S.codeResent);
      inputRef.current?.focus();
    } catch (err) {
      const retryAt = (err as { meta?: { retryAt?: unknown } })?.meta?.retryAt;
      if (typeof retryAt === 'string') { setResendAt(retryAt); setWaitStart(serverNow()); setCanResend(false); }
      handleError(err);
    } finally { setBusy(null); }
  };

  const subtitle = fill(challenge.codeSent ? S.codeSubtitle : S.codeReusedSubtitle, { email });

  return (
    <Box component="form" onSubmit={submit} noValidate aria-labelledby="login-code-title">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <AppIcon icon={MailCheck} size="md" />
        <Typography id="login-code-title" component="h2" variant="h6" fontWeight={700}>{S.codeTitle}</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, overflowWrap: 'anywhere' }}>{subtitle}</Typography>

      <Box aria-live="polite">
        {info && <Alert severity="success" sx={{ mb: 2 }}>{info}</Alert>}
      </Box>

      <TextField
        inputRef={inputRef}
        label={S.codeLabel}
        value={code}
        onChange={(e) => { setCode(sanitizeCode(e.target.value)); if (error) setError(null); }}
        fullWidth
        required
        autoComplete="one-time-code"
        error={!!error}
        helperText={error ?? S.codeHelper}
        FormHelperTextProps={{ role: error ? 'alert' : undefined }}
        inputProps={{ inputMode: 'numeric', pattern: '[0-9]*',
          style: { letterSpacing: '0.5em', fontSize: 22, textAlign: 'center', fontVariantNumeric: 'tabular-nums' } }}
        sx={{ mb: 2 }}
      />

      <Button type="submit" variant="contained" fullWidth size="large" disabled={code.length !== 6 || !!busy} sx={{ mb: 2 }}>
        {busy === 'verify' ? <CircularProgress size={22} color="inherit" /> : S.codeSubmit}
      </Button>

      {canResend ? (
        <Tooltip title={S.codeResendTooltip}>
          <span>
            <Button fullWidth variant="text" onClick={resend} disabled={!!busy}>
              {busy === 'resend' ? <CircularProgress size={20} color="inherit" /> : S.codeResend}
            </Button>
          </span>
        </Tooltip>
      ) : (
        <Box sx={{ mb: 1 }}>
          <CooldownBar
            key={resendAt}
            startAt={Math.min(waitStart, Date.parse(resendAt))}
            endAt={resendAt}
            ariaLabel={S.codeResendAria}
            label={S.codeResendWait}
            formatRemaining={(s) => (s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`)}
            size="small"
            onComplete={() => setCanResend(true)}
          />
        </Box>
      )}

      <Button fullWidth variant="text" color="inherit" onClick={onBack} disabled={!!busy}
        startIcon={<AppIcon icon={ArrowLeft} size="sm" />} sx={{ mt: 1, color: 'text.secondary' }}>
        {S.codeBack}
      </Button>
    </Box>
  );
}
