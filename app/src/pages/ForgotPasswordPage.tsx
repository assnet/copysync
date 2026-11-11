import { useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Fade, TextField, Tooltip, Typography } from '@mui/material';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { AppIcon } from '@/components/AppIcon';
import { CooldownBar } from '@/components/CooldownBar';
import { usePersistedState } from '@/hooks/usePersistedState';
import { serverNow } from '@/services/serverClock';
import { passwordResetService } from '@/services/passwordReset.service';
import { useLoginConfig } from '@/features/login-protection/useLoginConfig';
import { TurnstileWidget } from '@/features/login-protection/TurnstileWidget';
import { retryAtOf } from '@/features/login-protection/loginProtection';
import { loginProtectionStrings as LP } from '@/features/login-protection/strings';
import { PasswordResetCard, PasswordResetHeading, PasswordResetShell, PasswordResetStatus } from '@/features/passwordReset/PasswordResetShell';
import { requestErrorMessage } from '@/features/passwordReset/passwordResetErrors';
import { FORGOT_PASSWORD_PATH, passwordResetStrings as S } from '@/features/passwordReset/strings';
import { GOLDEN_SPACE, GOLDEN_TYPE } from './login/goldenRatio';

/** Espera entre um pedido e o reenvio (ms). Só conforto de tela: o limite real é o 429 da API. */
const RESEND_COOLDOWN_MS = 60_000;

const looksLikeEmail = (value: string) => /^\S+@\S+\.\S+$/.test(value.trim());

/**
 * Pedido do link de redefinição de senha. A confirmação é a mesma exista ou não a conta.
 * Rascunho do e-mail sobrevive a reload (escopo da aba) e é apagado ao enviar; token do
 * Turnstile fica só em memória.
 */
export function ForgotPasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();

  // E-mail vindo do login (router state) ou de `?email=`: consumido uma vez e tirado da URL/histórico.
  const incomingRef = useRef(
    ((location.state as { email?: unknown } | null)?.email as string | undefined)
      || new URLSearchParams(location.search).get('email')
      || '',
  );
  const [email, setEmail, clearEmail] = usePersistedState('passwordReset.email', '');
  useEffect(() => {
    const incoming = incomingRef.current;
    if (!incoming) return;
    setEmail(incoming);
    // Veio do login com um e-mail: é um pedido novo, não a confirmação de um anterior nesta aba.
    clearSent();
    navigate(FORGOT_PASSWORD_PATH, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { siteKey: turnstileSiteKey, reload: reloadLoginConfig } = useLoginConfig();
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedUntil, setBlockedUntil] = useState<string | null>(null);
  /**
   * Último pedido aceito (e-mail para o reenvio + horário do servidor): sobrevive a reload na aba,
   * senão a tela voltaria ao formulário e o intervalo de reenvio zeraria. Limpo em "Usar outro e-mail".
   */
  const [sent, setSent, clearSent] = usePersistedState<{ to: string; at: number } | null>('passwordReset.sent', null);
  const sentTo = sent?.to ?? null;
  const sentAt = sent?.at ?? 0;
  const [canResend, setCanResend] = useState(false);
  const [resent, setResent] = useState(false);

  // Bloqueio (429): libera o botão no `retryAt`, medido no relógio do servidor.
  useEffect(() => {
    if (!blockedUntil) return;
    const wait = Date.parse(blockedUntil) - serverNow();
    if (wait <= 0) { setBlockedUntil(null); return; }
    const t = window.setTimeout(() => { setBlockedUntil(null); setError(null); }, Math.min(wait, 2_147_000_000));
    return () => window.clearTimeout(t);
  }, [blockedUntil]);

  const send = async (target: string, isResend: boolean) => {
    setError(null);
    setResent(false);
    setLoading(true);
    try {
      await passwordResetService.request({ email: target.trim(), ...(turnstileToken ? { turnstileToken } : {}) });
      setSent({ to: target.trim(), at: serverNow() });
      setCanResend(false);
      setResent(isResend);
      // Só limpa rascunho que existe (no reenvio ele já está vazio).
      if (email) clearEmail();
    } catch (err) {
      const code = (err as { code?: string })?.code;
      setBlockedUntil(code === 'PASSWORD_RESET_TOO_MANY_REQUESTS' ? retryAtOf(err) : null);
      if (code === 'LOGIN_CAPTCHA_REQUIRED' && !turnstileSiteKey) {
        setError(LP.captchaUnavailable);
        void reloadLoginConfig();
      } else {
        setError(requestErrorMessage(err));
      }
    } finally {
      setLoading(false);
      // Token Turnstile é de uso único: novo desafio a cada tentativa.
      setTurnstileToken(null);
      if (turnstileSiteKey) setTurnstileReset((n) => n + 1);
    }
  };

  const needsTurnstile = !!turnstileSiteKey && !turnstileToken;

  const errorAlert = error && (
    <Alert severity="error" sx={{ mb: `${GOLDEN_SPACE.s3}px`, textAlign: 'left' }}>
      {error}
      {blockedUntil && (
        <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.85 }}>{S.tooManyRequestsHint}</Typography>
      )}
    </Alert>
  );

  const backToLogin = (
    <Button
      component={RouterLink}
      to="/login"
      fullWidth
      variant="text"
      color="inherit"
      startIcon={<AppIcon icon={ArrowLeft} size="sm" />}
      sx={{ mt: 1, color: 'text.secondary' }}
    >
      {S.backToLogin}
    </Button>
  );

  return (
    <PasswordResetShell>
      {sentTo ? (
        <Fade in>
          <Box>
            <PasswordResetStatus
              icon={MailCheck}
              tone="primary"
              title={S.sentTitle}
              message={(
                <>
                  <Typography>{S.sentMessage}</Typography>
                  <Typography variant="body2" sx={{ mt: 1 }}>{S.sentHint}</Typography>
                </>
              )}
            >
              <Box aria-live="polite">
                {resent && <Alert severity="success" sx={{ mb: `${GOLDEN_SPACE.s3}px`, textAlign: 'left' }}>{S.resent}</Alert>}
                {errorAlert}
              </Box>

              <Button component={RouterLink} to="/login" onClick={clearSent} variant="contained" fullWidth size="large" sx={{ mb: 2 }}>
                {S.backToLogin}
              </Button>

              {canResend ? (
                <>
                  {turnstileSiteKey && (
                    <TurnstileWidget siteKey={turnstileSiteKey} onToken={setTurnstileToken} resetSignal={turnstileReset} />
                  )}
                  <Tooltip title={S.resendTooltip}>
                    <span>
                      <Button
                        fullWidth
                        variant="text"
                        onClick={() => { void send(sentTo, true); }}
                        disabled={loading || !!blockedUntil || needsTurnstile}
                      >
                        {loading ? <CircularProgress size={20} color="inherit" /> : S.resend}
                      </Button>
                    </span>
                  </Tooltip>
                </>
              ) : (
                <Box sx={{ mb: 1, textAlign: 'left' }}>
                  <CooldownBar
                    key={sentAt}
                    startAt={sentAt}
                    endAt={sentAt + RESEND_COOLDOWN_MS}
                    ariaLabel={S.resendAria}
                    label={S.resendWait}
                    size="small"
                    onComplete={() => setCanResend(true)}
                  />
                </Box>
              )}

              <Button
                fullWidth
                variant="text"
                color="inherit"
                onClick={() => { clearSent(); setError(null); setResent(false); setBlockedUntil(null); }}
                disabled={loading}
                sx={{ mt: 1, color: 'text.secondary' }}
              >
                {S.useAnotherEmail}
              </Button>
            </PasswordResetStatus>
          </Box>
        </Fade>
      ) : (
        <Fade in>
          <Box>
            <PasswordResetHeading title={S.requestTitle} subtitle={S.requestSubtitle} />
            <PasswordResetCard>
              {errorAlert}
              <Box
                component="form"
                noValidate
                onSubmit={(e: React.FormEvent) => { e.preventDefault(); void send(email, false); }}
              >
                <TextField
                  label={S.emailLabel}
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); if (blockedUntil) { setBlockedUntil(null); setError(null); } }}
                  fullWidth
                  required
                  autoFocus
                  autoComplete="email"
                  sx={{ mb: `${GOLDEN_SPACE.s3}px` }}
                />
                {turnstileSiteKey && (
                  <TurnstileWidget siteKey={turnstileSiteKey} onToken={setTurnstileToken} resetSignal={turnstileReset} />
                )}
                <Button
                  type="submit"
                  variant="contained"
                  fullWidth
                  size="large"
                  disabled={loading || !looksLikeEmail(email) || !!blockedUntil || needsTurnstile}
                  sx={{ py: `${GOLDEN_SPACE.s2}px`, fontSize: GOLDEN_TYPE.base }}
                >
                  {loading ? <CircularProgress size={22} color="inherit" /> : S.requestSubmit}
                </Button>
              </Box>
              {backToLogin}
            </PasswordResetCard>
          </Box>
        </Fade>
      )}
    </PasswordResetShell>
  );
}
