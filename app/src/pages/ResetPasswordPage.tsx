import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import {
  Alert, Box, Button, CircularProgress, Fade, IconButton, InputAdornment, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import { CircleAlert, CircleCheck, Eye, EyeOff, WifiOff } from 'lucide-react';
import { AppIcon } from '@/components/AppIcon';
import { PasswordStrengthMeter } from '@/components/PasswordStrengthMeter';
import { passwordResetService } from '@/services/passwordReset.service';
import { maskEmail } from '@/features/invite/strings';
import { PasswordResetCard, PasswordResetHeading, PasswordResetShell, PasswordResetStatus } from '@/features/passwordReset/PasswordResetShell';
import { isResetLinkInvalid, resetErrorMessage } from '@/features/passwordReset/passwordResetErrors';
import { FORGOT_PASSWORD_PATH, passwordResetStrings as S } from '@/features/passwordReset/strings';
import { GOLDEN_SPACE, GOLDEN_TYPE } from './login/goldenRatio';

type PageState = 'loading' | 'valid' | 'invalid' | 'load-error' | 'done';

const MIN_PASSWORD_LENGTH = 8;
const MIN_TOUCH_TARGET = 44;
const STRENGTH_LABELS = [S.strengthWeak, S.strengthMedium, S.strengthStrong] as const;

/**
 * Redefinição de senha pelo link do e-mail (`/reset-password/:token`, 1 hora, uso único).
 * Senha e token ficam só em memória; o token nunca é exibido.
 */
export function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();

  const [pageState, setPageState] = useState<PageState>('loading');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const load = useCallback(async () => {
    if (!token) { setPageState('invalid'); return; }
    setPageState('loading');
    try {
      const info = await passwordResetService.getInfo(token);
      setEmail(info.email);
      setPageState('valid');
    } catch (err) {
      setPageState(isResetLinkInvalid(err) ? 'invalid' : 'load-error');
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const canSubmit = !submitting && password.length >= MIN_PASSWORD_LENGTH && password === confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !canSubmit) return;
    setSubmitError('');
    setSubmitting(true);
    try {
      await passwordResetService.reset(token, { password, confirmPassword });
      setPassword('');
      setConfirmPassword('');
      setPageState('done');
    } catch (err) {
      // Venceu ou foi usado em outra aba entre abrir a tela e enviar.
      if (isResetLinkInvalid(err)) { setPassword(''); setConfirmPassword(''); setPageState('invalid'); return; }
      setSubmitError(resetErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleLabel = showPassword ? S.hidePassword : S.showPassword;

  return (
    <PasswordResetShell>
      {pageState === 'loading' && (
        <Fade in>
          <Box sx={{ textAlign: 'center' }} role="status">
            <CircularProgress size={40} sx={{ mb: 2 }} />
            <Typography color="text.secondary">{S.loading}</Typography>
          </Box>
        </Fade>
      )}

      {pageState === 'invalid' && (
        <Fade in>
          <Box>
            <PasswordResetStatus icon={CircleAlert} tone="error" title={S.invalidTitle} message={S.invalidMessage}>
              <Stack spacing={1}>
                <Button component={RouterLink} to={FORGOT_PASSWORD_PATH} variant="contained" fullWidth size="large">
                  {S.requestNewLink}
                </Button>
                <Button component={RouterLink} to="/login" variant="text" fullWidth>
                  {S.goToLogin}
                </Button>
              </Stack>
            </PasswordResetStatus>
          </Box>
        </Fade>
      )}

      {pageState === 'load-error' && (
        <Fade in>
          <Box>
            <PasswordResetStatus icon={WifiOff} tone="error" title={S.loadErrorTitle} message={S.loadErrorMessage}>
              <Stack spacing={1}>
                <Button variant="contained" fullWidth size="large" onClick={() => { void load(); }}>
                  {S.retry}
                </Button>
                <Button component={RouterLink} to="/login" variant="text" fullWidth>
                  {S.goToLogin}
                </Button>
              </Stack>
            </PasswordResetStatus>
          </Box>
        </Fade>
      )}

      {pageState === 'done' && (
        <Fade in>
          <Box>
            <PasswordResetStatus icon={CircleCheck} tone="success" title={S.doneTitle} message={S.doneMessage}>
              <Button component={RouterLink} to="/login" variant="contained" fullWidth size="large">
                {S.doneLogin}
              </Button>
            </PasswordResetStatus>
          </Box>
        </Fade>
      )}

      {pageState === 'valid' && (
        <Fade in>
          <Box>
            <PasswordResetHeading title={S.resetTitle} subtitle={S.resetSubtitle} />
            <PasswordResetCard>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mb: `${GOLDEN_SPACE.s3}px` }}>
                <Typography variant="body2" color="text.secondary">{S.accountLabel}</Typography>
                <Typography variant="body2" fontWeight={600} sx={{ overflowWrap: 'anywhere', textAlign: 'right' }}>
                  {maskEmail(email)}
                </Typography>
              </Box>

              {submitError && (
                <Alert severity="error" sx={{ mb: `${GOLDEN_SPACE.s3}px` }}>{submitError}</Alert>
              )}

              <Box component="form" onSubmit={handleSubmit} noValidate>
                <TextField
                  label={S.passwordLabel}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  fullWidth
                  required
                  autoFocus
                  autoComplete="new-password"
                  error={tooShort}
                  helperText={tooShort ? S.passwordMinLength : undefined}
                  sx={{ mb: `${GOLDEN_SPACE.s2}px` }}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <Tooltip title={toggleLabel}>
                          <IconButton
                            onClick={() => setShowPassword((v) => !v)}
                            edge="end"
                            aria-label={toggleLabel}
                            aria-pressed={showPassword}
                            sx={{ width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET }}
                          >
                            <AppIcon icon={showPassword ? EyeOff : Eye} size="md" />
                          </IconButton>
                        </Tooltip>
                      </InputAdornment>
                    ),
                  }}
                />

                <Box sx={{ mb: `${GOLDEN_SPACE.s3}px` }}>
                  <PasswordStrengthMeter password={password} labels={STRENGTH_LABELS} ariaLabel={S.strengthAria} />
                </Box>

                <TextField
                  label={S.confirmPasswordLabel}
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  fullWidth
                  required
                  autoComplete="new-password"
                  error={mismatch}
                  helperText={mismatch ? S.passwordMismatch : undefined}
                  sx={{ mb: `${GOLDEN_SPACE.s4}px` }}
                />

                <Button
                  type="submit"
                  variant="contained"
                  fullWidth
                  size="large"
                  disabled={!canSubmit}
                  sx={{ py: `${GOLDEN_SPACE.s2}px`, fontSize: GOLDEN_TYPE.base }}
                >
                  {submitting ? <CircularProgress size={22} color="inherit" /> : S.resetSubmit}
                </Button>
              </Box>
            </PasswordResetCard>
          </Box>
        </Fade>
      )}
    </PasswordResetShell>
  );
}
