import { useEffect, useState } from 'react';
import { ThemeModeSelector } from '@/components/ThemeModeSelector';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Box, Card, CardContent, TextField, Button, Typography, Alert,
  CircularProgress, InputAdornment, IconButton, Chip, Tooltip,
  Stack, Link, alpha, useTheme,
} from '@mui/material';
import { Copy, Eye, EyeOff, ShoppingBag, Wrench } from 'lucide-react';
import { AppIcon } from '@/components/AppIcon';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { APP_NAME } from '@/shared/branding/brand';
import { LoginShowcasePanel } from './login/LoginShowcasePanel';
import { LoginMobileBanner } from './login/LoginMobileBanner';
import { LOGIN_COPY } from './login/loginContent';
import { GOLDEN_SPACE, GOLDEN_SPLIT, GOLDEN_TYPE } from './login/goldenRatio';
import { PRIVACY_POLICY_PATH, privacyPolicyLinkLabel } from '@/features/privacy-policy/strings';
import { SUPPORT_PATH, supportLinkLabel } from '@/features/support/strings';
import { BUY_NOW_PATH } from '@/features/platformLinks/links';
import { THANK_YOU_FROM_LOGIN_STATE, THANK_YOU_PATH } from '@/features/thankYou/strings';
import { authService } from '@/services/auth.service';
import { serverNow } from '@/services/serverClock';
import type { TenantRef } from '@/types/api.types';
import { useLoginConfig } from '@/features/login-protection/useLoginConfig';
import { TurnstileWidget } from '@/features/login-protection/TurnstileWidget';
import { LoginCodeStep } from '@/features/login-protection/LoginCodeStep';
import { loginErrorMessage, retryAtOf, type LoginCodeChallenge } from '@/features/login-protection/loginProtection';
import { loginProtectionStrings as LP } from '@/features/login-protection/strings';

const DEV_CREDENTIALS = [
  { label: 'Super Admin', email: import.meta.env.VITE_DEV_EMAIL || '', password: import.meta.env.VITE_DEV_PASSWORD || '' },
] as const;

const IS_DEV = import.meta.env.DEV;

/** Alvo de toque mínimo (px) para controles pequenos. */
const MIN_TOUCH_TARGET = 44;

/**
 * Tela de login.
 *
 * φ (proporção áurea) — ver `./login/goldenRatio.ts`:
 * - desktop (md+): painel visual 61,8% × formulário 38,2% (`GOLDEN_SPLIT`);
 * - tipografia 16 → 26 → 42 (`GOLDEN_TYPE`) e espaçamentos 8 × φⁿ (`GOLDEN_SPACE`);
 * - largura do formulário = 26 × 16 ≈ 416 px.
 * Copy, fotos e provas vivem em `./login/loginContent.ts`.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const { login, verifyLoginCode } = useAuth();
  const { loadTenants } = useTenant();
  const theme = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Proteção do login (docs/seguranca-login.md). Ticket e token só em memória, nunca em storage.
  const { siteKey: turnstileSiteKey, reload: reloadLoginConfig } = useLoginConfig();
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [challenge, setChallenge] = useState<LoginCodeChallenge | null>(null);
  const [blockedUntil, setBlockedUntil] = useState<string | null>(null);

  // Bloqueio (429): libera o botão no `retryAt`, medido no relógio do servidor.
  useEffect(() => {
    if (!blockedUntil) return;
    const wait = Date.parse(blockedUntil) - serverNow();
    if (wait <= 0) { setBlockedUntil(null); return; }
    const t = window.setTimeout(() => { setBlockedUntil(null); setError(null); }, Math.min(wait, 2_147_000_000));
    return () => window.clearTimeout(t);
  }, [blockedUntil]);

  const finishLogin = async (tenants: TenantRef[]) => {
    localStorage.removeItem('activeTenantId');
    localStorage.removeItem('activeTenantName');
    if (tenants.length > 0) {
      localStorage.setItem('activeTenantId', tenants[0].id);
      localStorage.setItem('activeTenantName', tenants[0].name);
    }
    await loadTenants();
    navigate('/dashboard');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const outcome = await login({ email, password, ...(turnstileToken ? { turnstileToken } : {}) });
      if (outcome.status === 'OTP_REQUIRED') {
        setChallenge(outcome.challenge);
        setPassword('');
        return;
      }
      await finishLogin(outcome.tenants);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      setBlockedUntil(code === 'LOGIN_TOO_MANY_ATTEMPTS' ? retryAtOf(err) : null);
      if (code === 'LOGIN_CAPTCHA_REQUIRED' && !turnstileSiteKey) {
        // API exige o desafio mas o widget não está na tela: avisa e busca a config de novo
        setError(LP.captchaUnavailable);
        void reloadLoginConfig();
      } else {
        setError(loginErrorMessage(err));
      }
    } finally {
      setLoading(false);
      // Token Turnstile é de uso único: novo desafio a cada tentativa.
      if (turnstileSiteKey) setTurnstileReset((n) => n + 1);
    }
  };

  const leaveCodeStep = (message: string | null) => {
    setChallenge(null);
    setError(message);
  };

  const needsTurnstile = !!turnstileSiteKey && !turnstileToken;

  const isDark = theme.palette.mode === 'dark';

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        // φ: 61,8% painel visual × 38,2% formulário no desktop; coluna única no mobile.
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: `${GOLDEN_SPLIT.major} ${GOLDEN_SPLIT.minor}` },
        gridTemplateRows: { xs: 'auto 1fr', md: '1fr' },
        bgcolor: 'background.default',
      }}
    >
      {/* Painel visual — desktop */}
      {/* Fixo na janela (sticky): se a coluna do formulário crescer, a apresentação não é cortada. */}
      <Box sx={{ display: { xs: 'none', md: 'block' }, position: 'sticky', top: 0, alignSelf: 'start', minHeight: '100vh', minWidth: 0 }}>
        <LoginShowcasePanel />
      </Box>

      {/* Faixa visual — mobile */}
      <Box sx={{ display: { xs: 'block', md: 'none' } }}>
        <LoginMobileBanner />
      </Box>

      {/* Painel de login */}
      <Box
        component="main"
        sx={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 0,
          px: { xs: `${GOLDEN_SPACE.s3}px`, sm: `${GOLDEN_SPACE.s5}px`, md: `${GOLDEN_SPACE.s4}px`, xl: `${GOLDEN_SPACE.s5}px` },
          // Telas baixas (ex.: 1280×720): respiro menor para o formulário inteiro caber.
          '@media (min-width: 900px) and (max-height: 800px)': { py: `${GOLDEN_SPACE.s4}px` },
          // xs: espaço extra no topo para o toggle de tema não encostar no título.
          pt: { xs: `${GOLDEN_SPACE.s6}px`, md: `${GOLDEN_SPACE.s5}px` },
          // xs: folga para o botão flutuante de suporte não cobrir o rodapé no fim da rolagem.
          pb: { xs: 'calc(88px + env(safe-area-inset-bottom))', md: `${GOLDEN_SPACE.s5}px` },
          // Brilho discreto do azul da marca atrás do card (ancora o glass).
          backgroundImage: `radial-gradient(60% 50% at 50% 38.2%, ${alpha(theme.palette.primary.main, isDark ? 0.16 : 0.1)} 0%, transparent 100%)`,
        }}
      >
        {/* Toggle tema */}
        <Box sx={{ position: 'absolute', top: `${GOLDEN_SPACE.s3}px`, right: `${GOLDEN_SPACE.s3}px` }}>
          <ThemeModeSelector />
        </Box>

        <Box sx={{ width: '100%', maxWidth: GOLDEN_TYPE.lead * 16 /* ≈ 416 px */ }}>
          <Typography
            component="h1"
            sx={{ fontSize: GOLDEN_TYPE.lead, fontWeight: 800, letterSpacing: -0.6, lineHeight: 1.15, mb: `${GOLDEN_SPACE.s1}px` }}
          >
            {LOGIN_COPY.formTitle}
          </Typography>
          <Typography sx={{ fontSize: GOLDEN_TYPE.base, color: 'text.secondary', mb: `${GOLDEN_SPACE.s4}px` }}>
            {LOGIN_COPY.formSubtitle}
          </Typography>

          {/* Formulário — card com glass sutil */}
          <Card
            elevation={0}
            sx={{
              mb: `${GOLDEN_SPACE.s3}px`,
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
              {challenge ? (
                <LoginCodeStep
                  email={email}
                  challenge={challenge}
                  onVerify={async (code) => { await finishLogin(await verifyLoginCode(challenge.ticket, code)); }}
                  onResend={async () => {
                    const next = await authService.resendLoginCode(challenge.ticket);
                    setChallenge(next);
                    return next;
                  }}
                  onBack={() => leaveCodeStep(null)}
                  onExpired={(message) => leaveCodeStep(message)}
                />
              ) : (
                <>
              {error && (
                <Alert severity="error" sx={{ mb: `${GOLDEN_SPACE.s3}px` }}>
                  {error}
                  {blockedUntil && (
                    <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.85 }}>{LP.tooManyAttemptsHint}</Typography>
                  )}
                </Alert>
              )}

              <Box component="form" onSubmit={handleSubmit} noValidate>
                <TextField
                  label={LOGIN_COPY.form.email}
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); if (blockedUntil) { setBlockedUntil(null); setError(null); } }}
                  fullWidth
                  required
                  autoFocus
                  autoComplete="email"
                  sx={{ mb: `${GOLDEN_SPACE.s3}px` }}
                />
                <TextField
                  label={LOGIN_COPY.form.password}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  fullWidth
                  required
                  autoComplete="current-password"
                  sx={{ mb: `${turnstileSiteKey ? GOLDEN_SPACE.s3 : GOLDEN_SPACE.s4}px` }}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <Tooltip title={showPassword ? LOGIN_COPY.form.hidePassword : LOGIN_COPY.form.showPassword}>
                          <IconButton
                            onClick={() => setShowPassword((v) => !v)}
                            edge="end"
                            aria-label={showPassword ? LOGIN_COPY.form.hidePassword : LOGIN_COPY.form.showPassword}
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
                {turnstileSiteKey && (
                  <TurnstileWidget siteKey={turnstileSiteKey} onToken={setTurnstileToken} resetSignal={turnstileReset} />
                )}
                <Button
                  type="submit"
                  variant="contained"
                  fullWidth
                  size="large"
                  disabled={loading || !email || !password || !!blockedUntil || needsTurnstile}
                  sx={{
                    py: `${GOLDEN_SPACE.s2}px`,
                    fontSize: GOLDEN_TYPE.base,
                    transition: 'transform 160ms ease, box-shadow 160ms ease',
                    '&:hover:not(:disabled)': { transform: 'translateY(-1px)' },
                    '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
                  }}
                >
                  {loading ? <CircularProgress size={22} color="inherit" /> : LOGIN_COPY.form.submit}
                </Button>
              </Box>

              {/* Primeiro acesso: discreto, para quem comprou e ainda não definiu a senha. */}
              <Typography
                sx={{
                  fontSize: GOLDEN_TYPE.caption, color: 'text.secondary', textAlign: 'center',
                  mt: `${GOLDEN_SPACE.s1}px`, mb: `-${GOLDEN_SPACE.s3}px`,
                }}
              >
                {LOGIN_COPY.firstAccess.prompt}{' '}
                <Link
                  component={RouterLink}
                  to={THANK_YOU_PATH}
                  state={THANK_YOU_FROM_LOGIN_STATE}
                  underline="hover"
                  sx={{
                    // Área de toque de 44 px sem aumentar o peso visual do link.
                    display: 'inline-block', py: '12px', fontWeight: 600, borderRadius: 0.5,
                    '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
                  }}
                >
                  {LOGIN_COPY.firstAccess.link}
                </Link>
              </Typography>
                </>
              )}
            </CardContent>
          </Card>

          {/* Ainda não é cliente: CTA secundário forte (o primário segue sendo "Entrar"). */}
          {!challenge && (
            <Box
              component="section"
              aria-labelledby="login-buy-title"
              sx={{
                display: 'flex', flexWrap: 'wrap', alignItems: 'center',
                gap: `${GOLDEN_SPACE.s2}px`,
                mb: `${GOLDEN_SPACE.s3}px`,
                p: `${GOLDEN_SPACE.s2}px ${GOLDEN_SPACE.s3}px`,
                borderRadius: `${GOLDEN_SPACE.s3}px`,
                bgcolor: alpha(theme.palette.primary.main, isDark ? 0.12 : 0.06),
                border: `1px solid ${alpha(theme.palette.primary.main, isDark ? 0.32 : 0.2)}`,
              }}
            >
              <Box sx={{ flex: '1 1 180px', minWidth: 0 }}>
                <Typography id="login-buy-title" component="h2" sx={{ fontSize: GOLDEN_TYPE.base, fontWeight: 700, lineHeight: 1.3 }}>
                  {LOGIN_COPY.buy.title}
                </Typography>
                <Typography sx={{ fontSize: GOLDEN_TYPE.caption, color: 'text.secondary', lineHeight: 1.45 }}>
                  {LOGIN_COPY.buy.body}
                </Typography>
              </Box>
              <Tooltip title={LOGIN_COPY.buy.tooltip} describeChild>
                <Button
                  component="a"
                  href={BUY_NOW_PATH}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="outlined"
                  startIcon={<AppIcon icon={ShoppingBag} />}
                  sx={{
                    flex: { xs: '1 1 100%', sm: '0 0 auto' },
                    minHeight: MIN_TOUCH_TARGET, px: `${GOLDEN_SPACE.s3}px`,
                    fontWeight: 700, whiteSpace: 'nowrap', borderWidth: 1.5,
                    bgcolor: 'background.paper',
                    '&:hover': { borderWidth: 1.5 },
                  }}
                >
                  {LOGIN_COPY.buy.cta}
                </Button>
              </Tooltip>
            </Box>
          )}

          {/* Credenciais de dev */}
          {IS_DEV && (
            <Card
              sx={{
                mb: 3,
                border: '1px dashed',
                borderColor: 'warning.main',
                bgcolor: alpha(theme.palette.warning.main, 0.05),
              }}
            >
              <CardContent sx={{ p: '12px 16px !important' }}>
                <Typography
                  variant="caption"
                  fontWeight={700}
                  color="warning.dark"
                  mb={1}
                  sx={{ display: 'flex', alignItems: 'center', gap: 0.75, textTransform: 'uppercase', letterSpacing: 0.5 }}
                >
                  <AppIcon icon={Wrench} />
                  {LOGIN_COPY.dev.title}
                </Typography>
                <Stack spacing={1}>
                  {DEV_CREDENTIALS.map((cred) => (
                    <Box
                      key={cred.email}
                      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="caption" fontWeight={600} display="block">{cred.label}</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: 11 }}>
                          {cred.email} · {cred.password}
                        </Typography>
                      </Box>
                      <Tooltip title={LOGIN_COPY.dev.fillTooltip}>
                        <Chip
                          label={LOGIN_COPY.dev.fill}
                          size="small"
                          color="warning"
                          variant="outlined"
                          icon={<AppIcon icon={Copy} size="sm" />}
                          onClick={() => { setEmail(cred.email); setPassword(cred.password); }}
                          sx={{ cursor: 'pointer', fontSize: 11 }}
                        />
                      </Tooltip>
                    </Box>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          )}

          <Typography sx={{ fontSize: GOLDEN_TYPE.caption, color: 'text.disabled', textAlign: 'center', mt: `${GOLDEN_SPACE.s3}px` }}>
            © {new Date().getFullYear()} {APP_NAME} · {LOGIN_COPY.footerRights}
            {' · '}
            <Link
              href={PRIVACY_POLICY_PATH}
              target="_blank"
              rel="noopener noreferrer"
              color="inherit"
              underline="hover"
              sx={{ '&:hover': { color: 'text.secondary' } }}
            >
              {privacyPolicyLinkLabel}
            </Link>
            {' · '}
            <Link
              href={SUPPORT_PATH}
              target="_blank"
              rel="noopener noreferrer"
              color="inherit"
              underline="hover"
              sx={{ '&:hover': { color: 'text.secondary' } }}
            >
              {supportLinkLabel}
            </Link>
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
