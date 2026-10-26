import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Card, CardContent, TextField, Button, Typography, Alert,
  CircularProgress, InputAdornment, IconButton, Chip, Tooltip,
  Stack, alpha, useTheme,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { useColorMode } from '@/contexts/ThemeContext';
import { APP_NAME } from '@/shared/branding/brand';
import { LoginShowcasePanel } from './login/LoginShowcasePanel';
import { LoginMobileBanner } from './login/LoginMobileBanner';
import { LOGIN_COPY } from './login/loginContent';
import { GOLDEN_SPACE, GOLDEN_SPLIT, GOLDEN_TYPE } from './login/goldenRatio';

const DEV_CREDENTIALS = [
  { label: 'Super Admin', email: import.meta.env.VITE_DEV_EMAIL || '', password: import.meta.env.VITE_DEV_PASSWORD || '' },
] as const;

const IS_DEV = import.meta.env.DEV;

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
  const { login } = useAuth();
  const { loadTenants } = useTenant();
  const { mode, toggleColorMode } = useColorMode();
  const theme = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const tenants = await login({ email, password });
      localStorage.removeItem('activeTenantId');
      localStorage.removeItem('activeTenantName');
      if (tenants.length > 0) {
        localStorage.setItem('activeTenantId', tenants[0].id);
        localStorage.setItem('activeTenantName', tenants[0].name);
      }
      await loadTenants();
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao fazer login');
    } finally {
      setLoading(false);
    }
  };

  const isDark = theme.palette.mode === 'dark';

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        // φ: 61,8% painel visual × 38,2% formulário no desktop; coluna única no mobile.
        gridTemplateColumns: { xs: '1fr', md: `${GOLDEN_SPLIT.major} ${GOLDEN_SPLIT.minor}` },
        gridTemplateRows: { xs: 'auto 1fr', md: '1fr' },
        bgcolor: 'background.default',
      }}
    >
      {/* Painel visual — desktop */}
      <Box sx={{ display: { xs: 'none', md: 'block' }, minHeight: '100vh' }}>
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
          px: { xs: `${GOLDEN_SPACE.s3}px`, sm: `${GOLDEN_SPACE.s5}px` },
          // xs: espaço extra no topo para o toggle de tema não encostar no título.
          pt: { xs: `${GOLDEN_SPACE.s6}px`, md: `${GOLDEN_SPACE.s5}px` },
          pb: { xs: `${GOLDEN_SPACE.s4}px`, md: `${GOLDEN_SPACE.s5}px` },
          // Brilho discreto do azul da marca atrás do card (ancora o glass).
          backgroundImage: `radial-gradient(60% 50% at 50% 38.2%, ${alpha(theme.palette.primary.main, isDark ? 0.16 : 0.1)} 0%, transparent 100%)`,
        }}
      >
        {/* Toggle tema */}
        <Box sx={{ position: 'absolute', top: `${GOLDEN_SPACE.s3}px`, right: `${GOLDEN_SPACE.s3}px` }}>
          <Tooltip title={mode === 'dark' ? 'Tema claro' : 'Tema escuro'}>
            <IconButton size="small" onClick={toggleColorMode} aria-label={mode === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}>
              {mode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
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
              {error && (
                <Alert severity="error" sx={{ mb: `${GOLDEN_SPACE.s3}px` }}>
                  {error}
                </Alert>
              )}

              <Box component="form" onSubmit={handleSubmit} noValidate>
                <TextField
                  label="E-mail"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  fullWidth
                  required
                  autoFocus
                  autoComplete="email"
                  sx={{ mb: `${GOLDEN_SPACE.s3}px` }}
                />
                <TextField
                  label="Senha"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  fullWidth
                  required
                  autoComplete="current-password"
                  sx={{ mb: `${GOLDEN_SPACE.s4}px` }}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <Tooltip title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>
                          <IconButton
                            onClick={() => setShowPassword((v) => !v)}
                            edge="end"
                            size="small"
                            aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                          >
                            {showPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                          </IconButton>
                        </Tooltip>
                      </InputAdornment>
                    ),
                  }}
                />
                <Button
                  type="submit"
                  variant="contained"
                  fullWidth
                  size="large"
                  disabled={loading || !email || !password}
                  sx={{
                    py: `${GOLDEN_SPACE.s2}px`,
                    fontSize: GOLDEN_TYPE.base,
                    transition: 'transform 160ms ease, box-shadow 160ms ease',
                    '&:hover:not(:disabled)': { transform: 'translateY(-1px)' },
                    '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
                  }}
                >
                  {loading ? <CircularProgress size={22} color="inherit" /> : 'Entrar'}
                </Button>
              </Box>
            </CardContent>
          </Card>

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
                  display="block"
                  mb={1}
                  sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}
                >
                  🛠 Credenciais de desenvolvimento
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
                      <Tooltip title="Preencher formulário">
                        <Chip
                          label="Usar"
                          size="small"
                          color="warning"
                          variant="outlined"
                          icon={<ContentCopyIcon sx={{ fontSize: '14px !important' }} />}
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
            © {new Date().getFullYear()} {APP_NAME} · Todos os direitos reservados
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
