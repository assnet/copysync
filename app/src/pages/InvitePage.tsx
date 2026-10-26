import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, Link as RouterLink } from 'react-router-dom';
import {
  Box, Card, CardContent, TextField, Button, Typography, Alert,
  CircularProgress, InputAdornment, IconButton, Tooltip, LinearProgress,
  alpha, useTheme, Fade,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import GroupAddIcon from '@mui/icons-material/GroupAdd';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { useColorMode } from '@/contexts/ThemeContext';
import { APP_NAME } from '@/shared/branding/brand';
import { BrandLogo } from '@/shared/branding/BrandLogo';
import { GOLDEN_SPACE, GOLDEN_TYPE } from './login/goldenRatio';
import { inviteService, type InviteInfo } from '@/services/invite.service';
import { inviteStrings, translateRole, maskEmail } from '@/features/invite/strings';

type PageState = 'loading' | 'valid' | 'needs-login' | 'accepted' | 'error';

/** Calcula forca da senha: 0 = fraca, 1 = media, 2 = forte. */
function passwordStrength(pw: string): number {
  if (pw.length < 8) return 0;
  let score = 0;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  if (pw.length >= 12) score++;
  return score <= 1 ? 0 : score <= 2 ? 1 : 2;
}

const STRENGTH_LABELS = [
  inviteStrings.strengthWeak,
  inviteStrings.strengthMedium,
  inviteStrings.strengthStrong,
];
const STRENGTH_COLORS = ['error', 'warning', 'success'] as const;

export function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { mode, toggleColorMode } = useColorMode();
  const theme = useTheme();

  const [pageState, setPageState] = useState<PageState>('loading');
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  /* ---------- buscar info do convite ---------- */
  const fetchInvite = useCallback(async () => {
    if (!token) { setPageState('error'); return; }
    setPageState('loading');
    try {
      const info = await inviteService.getInfo(token);
      setInvite(info);
      if (info.requiresLogin) {
        setPageState('needs-login');
      } else {
        setPageState('valid');
      }
    } catch {
      setPageState('error');
      setErrorMsg(inviteStrings.invalidMessage);
    }
  }, [token]);

  useEffect(() => { fetchInvite(); }, [fetchInvite]);

  /* ---------- aceitar convite ---------- */
  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSubmitError('');
    setSubmitting(true);
    try {
      const body = invite?.requiresPassword
        ? { password, confirmPassword }
        : {};
      const result = await inviteService.accept(token, body);
      if (result.status === 'ACCEPTED') {
        setPageState('accepted');
        setTimeout(() => navigate('/login'), 3000);
      } else {
        setPageState('needs-login');
      }
    } catch (err) {
      const msg = (err as { message?: string })?.message || inviteStrings.genericError;
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------- validacoes ---------- */
  const strength = passwordStrength(password);
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const canSubmit =
    !submitting
    && (!invite?.requiresPassword || (password.length >= 8 && password === confirmPassword));

  const isDark = theme.palette.mode === 'dark';

  /* ---------- card wrapper comum ---------- */
  const renderCard = (children: React.ReactNode) => (
    <Card
      elevation={0}
      sx={{
        borderRadius: `${GOLDEN_SPACE.s3}px`,
        bgcolor: alpha(theme.palette.background.paper, isDark ? 0.72 : 0.8),
        backdropFilter: 'blur(14px)',
        border: `1px solid ${alpha(isDark ? '#fff' : theme.palette.primary.main, isDark ? 0.1 : 0.14)}`,
        boxShadow: isDark
          ? `0 ${GOLDEN_SPACE.s3}px ${GOLDEN_SPACE.s5}px ${alpha('#000', 0.45)}`
          : `0 ${GOLDEN_SPACE.s3}px ${GOLDEN_SPACE.s5}px ${alpha(theme.palette.primary.dark, 0.12)}`,
      }}
    >
      <CardContent sx={{ p: `${GOLDEN_SPACE.s4}px !important` }}>
        {children}
      </CardContent>
    </Card>
  );

  /* ---------- info row ---------- */
  const InfoRow = ({ label, value }: { label: string; value: string }) => (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.75 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" fontWeight={600}>{value}</Typography>
    </Box>
  );

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        px: { xs: `${GOLDEN_SPACE.s3}px`, sm: `${GOLDEN_SPACE.s5}px` },
        py: `${GOLDEN_SPACE.s5}px`,
        backgroundImage: `radial-gradient(60% 50% at 50% 38.2%, ${alpha(theme.palette.primary.main, isDark ? 0.16 : 0.1)} 0%, transparent 100%)`,
      }}
    >
      {/* Toggle tema */}
      <Box sx={{ position: 'fixed', top: `${GOLDEN_SPACE.s3}px`, right: `${GOLDEN_SPACE.s3}px`, zIndex: 10 }}>
        <Tooltip title={mode === 'dark' ? 'Tema claro' : 'Tema escuro'}>
          <IconButton size="small" onClick={toggleColorMode} aria-label={mode === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}>
            {mode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ width: '100%', maxWidth: 440 }}>
        {/* Logo */}
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: `${GOLDEN_SPACE.s4}px` }}>
          <BrandLogo size={56} />
        </Box>

        {/* --- LOADING --- */}
        {pageState === 'loading' && (
          <Fade in>
            <Box sx={{ textAlign: 'center' }}>
              <CircularProgress size={40} sx={{ mb: 2 }} />
              <Typography color="text.secondary">{inviteStrings.loading}</Typography>
            </Box>
          </Fade>
        )}

        {/* --- ERROR --- */}
        {pageState === 'error' && (
          <Fade in>
            <Box>
              {renderCard(
                <Box sx={{ textAlign: 'center', py: `${GOLDEN_SPACE.s2}px` }}>
                  <ErrorOutlineIcon color="error" sx={{ fontSize: 48, mb: 2 }} />
                  <Typography variant="h6" fontWeight={700} gutterBottom>
                    {inviteStrings.invalidTitle}
                  </Typography>
                  <Typography color="text.secondary" sx={{ mb: 3 }}>
                    {errorMsg || inviteStrings.invalidMessage}
                  </Typography>
                  <Button
                    component={RouterLink}
                    to="/login"
                    variant="outlined"
                  >
                    {inviteStrings.backToLogin}
                  </Button>
                </Box>,
              )}
            </Box>
          </Fade>
        )}

        {/* --- ACCEPTED --- */}
        {pageState === 'accepted' && (
          <Fade in>
            <Box>
              {renderCard(
                <Box sx={{ textAlign: 'center', py: `${GOLDEN_SPACE.s2}px` }}>
                  <CheckCircleOutlineIcon color="success" sx={{ fontSize: 48, mb: 2 }} />
                  <Typography variant="h6" fontWeight={700} gutterBottom>
                    {inviteStrings.acceptedTitle}
                  </Typography>
                  <Typography color="text.secondary" sx={{ mb: 2 }}>
                    {inviteStrings.acceptedMessage}
                  </Typography>
                  <Typography variant="caption" color="text.disabled">
                    {inviteStrings.redirectingToLogin}
                  </Typography>
                </Box>,
              )}
            </Box>
          </Fade>
        )}

        {/* --- NEEDS LOGIN --- */}
        {pageState === 'needs-login' && invite && (
          <Fade in>
            <Box>
              {renderCard(
                <Box sx={{ textAlign: 'center', py: `${GOLDEN_SPACE.s2}px` }}>
                  <GroupAddIcon color="primary" sx={{ fontSize: 48, mb: 2 }} />
                  <Typography variant="h6" fontWeight={700} gutterBottom>
                    {inviteStrings.existingUserTitle}
                  </Typography>
                  <Box sx={{ mb: 3, px: 1 }}>
                    <InfoRow label={inviteStrings.teamLabel} value={invite.tenantName} />
                    <InfoRow label={inviteStrings.roleLabel} value={translateRole(invite.role)} />
                    <InfoRow label={inviteStrings.emailLabel} value={maskEmail(invite.email)} />
                  </Box>
                  <Typography color="text.secondary" sx={{ mb: 3 }}>
                    {inviteStrings.existingUserMessage}
                  </Typography>
                  <Button
                    component={RouterLink}
                    to="/login"
                    variant="contained"
                    fullWidth
                    size="large"
                  >
                    {inviteStrings.goToLogin}
                  </Button>
                </Box>,
              )}
            </Box>
          </Fade>
        )}

        {/* --- VALID (form de criacao) --- */}
        {pageState === 'valid' && invite && (
          <Fade in>
            <Box>
              <Typography
                component="h1"
                sx={{
                  fontSize: GOLDEN_TYPE.lead,
                  fontWeight: 800,
                  letterSpacing: -0.6,
                  lineHeight: 1.15,
                  mb: `${GOLDEN_SPACE.s1}px`,
                  textAlign: 'center',
                }}
              >
                {inviteStrings.title}
              </Typography>
              <Typography sx={{ fontSize: GOLDEN_TYPE.base, color: 'text.secondary', mb: `${GOLDEN_SPACE.s4}px`, textAlign: 'center' }}>
                {inviteStrings.subtitle}
              </Typography>

              {renderCard(
                <>
                  {/* Detalhes do convite */}
                  <Box sx={{ mb: `${GOLDEN_SPACE.s3}px` }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                      <GroupAddIcon color="primary" />
                      <Typography fontWeight={700}>{invite.tenantName}</Typography>
                    </Box>
                    <InfoRow label={inviteStrings.roleLabel} value={translateRole(invite.role)} />
                    <InfoRow label={inviteStrings.emailLabel} value={maskEmail(invite.email)} />
                  </Box>

                  {submitError && (
                    <Alert severity="error" sx={{ mb: `${GOLDEN_SPACE.s3}px` }}>
                      {submitError}
                    </Alert>
                  )}

                  {/* Formulario de senha (novo usuario) */}
                  {invite.requiresPassword ? (
                    <Box component="form" onSubmit={handleAccept} noValidate>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: `${GOLDEN_SPACE.s3}px` }}>
                        {inviteStrings.passwordTitle}
                      </Typography>

                      <TextField
                        label={inviteStrings.passwordLabel}
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        fullWidth
                        required
                        autoFocus
                        autoComplete="new-password"
                        error={password.length > 0 && password.length < 8}
                        helperText={password.length > 0 && password.length < 8 ? inviteStrings.passwordMinLength : undefined}
                        sx={{ mb: `${GOLDEN_SPACE.s2}px` }}
                        InputProps={{
                          endAdornment: (
                            <InputAdornment position="end">
                              <Tooltip title={showPassword ? inviteStrings.hidePassword : inviteStrings.showPassword}>
                                <IconButton
                                  onClick={() => setShowPassword((v) => !v)}
                                  edge="end"
                                  size="small"
                                  aria-label={showPassword ? inviteStrings.hidePassword : inviteStrings.showPassword}
                                >
                                  {showPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                                </IconButton>
                              </Tooltip>
                            </InputAdornment>
                          ),
                        }}
                      />

                      {/* Indicador de forca */}
                      {password.length > 0 && (
                        <Box sx={{ mb: `${GOLDEN_SPACE.s3}px` }}>
                          <LinearProgress
                            variant="determinate"
                            value={(strength + 1) * 33.3}
                            color={STRENGTH_COLORS[strength]}
                            sx={{ height: 4, borderRadius: 2, mb: 0.5 }}
                          />
                          <Typography variant="caption" color={`${STRENGTH_COLORS[strength]}.main`}>
                            {STRENGTH_LABELS[strength]}
                          </Typography>
                        </Box>
                      )}

                      <TextField
                        label={inviteStrings.confirmPasswordLabel}
                        type={showPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        fullWidth
                        required
                        autoComplete="new-password"
                        error={mismatch}
                        helperText={mismatch ? inviteStrings.passwordMismatch : undefined}
                        sx={{ mb: `${GOLDEN_SPACE.s4}px` }}
                      />

                      <Button
                        type="submit"
                        variant="contained"
                        fullWidth
                        size="large"
                        disabled={!canSubmit}
                        sx={{
                          py: `${GOLDEN_SPACE.s2}px`,
                          fontSize: GOLDEN_TYPE.base,
                          transition: 'transform 160ms ease, box-shadow 160ms ease',
                          '&:hover:not(:disabled)': { transform: 'translateY(-1px)' },
                          '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
                        }}
                      >
                        {submitting
                          ? <CircularProgress size={22} color="inherit" />
                          : inviteStrings.submitCreate}
                      </Button>
                    </Box>
                  ) : (
                    /* Sem senha necessaria — apenas botao de aceitar */
                    <Box component="form" onSubmit={handleAccept} noValidate>
                      <Button
                        type="submit"
                        variant="contained"
                        fullWidth
                        size="large"
                        disabled={submitting}
                        sx={{
                          py: `${GOLDEN_SPACE.s2}px`,
                          fontSize: GOLDEN_TYPE.base,
                        }}
                      >
                        {submitting
                          ? <CircularProgress size={22} color="inherit" />
                          : inviteStrings.submitCreate}
                      </Button>
                    </Box>
                  )}
                </>,
              )}
            </Box>
          </Fade>
        )}

        {/* Footer */}
        <Typography sx={{ fontSize: GOLDEN_TYPE.caption, color: 'text.disabled', textAlign: 'center', mt: `${GOLDEN_SPACE.s3}px` }}>
          {inviteStrings.footer(new Date().getFullYear())} {APP_NAME}
        </Typography>
      </Box>
    </Box>
  );
}
