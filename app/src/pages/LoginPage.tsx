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
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import StorefrontIcon from '@mui/icons-material/Storefront';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ScheduleIcon from '@mui/icons-material/Schedule';
import AltRouteIcon from '@mui/icons-material/AltRoute';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { useColorMode } from '@/contexts/ThemeContext';
import { APP_NAME } from '@/shared/branding/brand';
import { BrandLogo } from '@/shared/branding/BrandLogo';

const DEV_CREDENTIALS = [
  { label: 'Super Admin', email: import.meta.env.VITE_DEV_EMAIL || '', password: import.meta.env.VITE_DEV_PASSWORD || '' },
] as const;

const IS_DEV = import.meta.env.DEV;

/** Navy da marca (logo); o gradiente vai daqui até `primary.main`, sem roxo. */
const BRAND_NAVY = '#0b1a4a';

/** Provas exibidas no painel de apresentação — alinhadas ao roadmap do produto. */
const LOGIN_BENEFITS = [
  {
    label: 'WhatsApp e Telegram',
    hint: 'Conecte seus números e contas para monitorar grupos e publicar ofertas.',
    Icon: WhatsAppIcon,
  },
  {
    label: 'Shopee, Mercado Livre e Amazon',
    hint: 'Ligue suas contas de afiliado e cada oferta sai com o seu link.',
    Icon: StorefrontIcon,
  },
  {
    label: 'Texto reescrito com IA',
    hint: 'Cada oferta ganha um texto novo, sem parecer cópia do concorrente.',
    Icon: AutoAwesomeIcon,
  },
  {
    label: 'Horário programado',
    hint: 'Escolha a janela de horários e as ofertas saem sozinhas.',
    Icon: ScheduleIcon,
  },
  {
    label: 'Rodízio de links',
    hint: 'Um link só que distribui quem entra entre os seus grupos.',
    Icon: AltRouteIcon,
  },
] as const;

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

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        bgcolor: 'background.default',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Painel de apresentação (desktop) */}
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          justifyContent: 'center',
          p: 8,
          width: '45%',
          flexShrink: 0,
          background: `linear-gradient(155deg, ${BRAND_NAVY} 0%, #15307e 55%, ${theme.palette.primary.main} 100%)`,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Brilhos suaves em azul da marca */}
        <Box
          aria-hidden
          sx={{
            position: 'absolute', top: -140, right: -120,
            width: 420, height: 420, borderRadius: '50%',
            background: `radial-gradient(circle, ${alpha(theme.palette.primary.light, 0.45)} 0%, transparent 70%)`,
          }}
        />
        <Box
          aria-hidden
          sx={{
            position: 'absolute', bottom: -160, left: -100,
            width: 380, height: 380, borderRadius: '50%',
            background: `radial-gradient(circle, ${alpha('#fff', 0.1)} 0%, transparent 70%)`,
          }}
        />

        <Box sx={{ position: 'relative', zIndex: 1 }}>
          {/* Logo */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 6 }}>
            <BrandLogo size={44} />
            <Typography variant="h5" sx={{ color: '#fff', fontWeight: 800, letterSpacing: -0.5 }}>
              {APP_NAME}
            </Typography>
          </Box>

          <Typography
            component="h2"
            variant="h4"
            sx={{ color: '#fff', mb: 2, maxWidth: 420, fontWeight: 800, letterSpacing: -0.5, lineHeight: 1.2 }}
          >
            Suas ofertas de afiliado publicadas no automático
          </Typography>
          <Typography sx={{ color: alpha('#fff', 0.8), lineHeight: 1.7, maxWidth: 400, fontSize: '0.95rem' }}>
            Monitora os grupos que você escolher, troca o link pelo seu, reescreve o texto com IA e
            dispara nos seus grupos. Sem copiar e colar o dia inteiro.
          </Typography>

          {/* Provas / benefícios */}
          <Stack component="ul" spacing={1.25} sx={{ m: 0, mt: 5, p: 0, listStyle: 'none' }}>
            {LOGIN_BENEFITS.map(({ label, hint, Icon }) => (
              <Tooltip key={label} title={hint} placement="right" arrow enterDelay={300} describeChild>
                <Box
                  component="li"
                  tabIndex={0}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 1.5,
                    px: 1.5, py: 1, borderRadius: 2, cursor: 'default',
                    bgcolor: alpha('#fff', 0.06),
                    border: `1px solid ${alpha('#fff', 0.1)}`,
                    transition: 'background-color 150ms ease',
                    '&:hover, &:focus-visible': { bgcolor: alpha('#fff', 0.12), outline: 'none' },
                    '&:focus-visible': { boxShadow: `0 0 0 2px ${alpha('#fff', 0.6)}` },
                  }}
                >
                  <Box
                    sx={{
                      width: 34, height: 34, borderRadius: '10px', flexShrink: 0,
                      bgcolor: alpha('#fff', 0.14),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Icon aria-hidden sx={{ fontSize: 19, color: '#fff' }} />
                  </Box>
                  <Typography sx={{ color: alpha('#fff', 0.92), fontSize: '0.9rem', fontWeight: 600 }}>
                    {label}
                  </Typography>
                </Box>
              </Tooltip>
            ))}
          </Stack>
        </Box>
      </Box>

      {/* Painel de login */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          p: { xs: 3, sm: 6 },
          position: 'relative',
        }}
      >
        {/* Toggle tema */}
        <Box sx={{ position: 'absolute', top: 20, right: 20 }}>
          <Tooltip title={mode === 'dark' ? 'Tema claro' : 'Tema escuro'}>
            <IconButton size="small" onClick={toggleColorMode}>
              {mode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Box>

        <Box sx={{ width: '100%', maxWidth: 400 }}>
          {/* Logo mobile */}
          <Box sx={{ display: { xs: 'flex', md: 'none' }, alignItems: 'center', gap: 1.5, mb: 4 }}>
            <BrandLogo size={40} />
            <Typography variant="h5" fontWeight={800} letterSpacing={-0.5}>{APP_NAME}</Typography>
          </Box>

          <Typography component="h1" variant="h5" fontWeight={700} mb={0.5}>
            Bem-vindo de volta
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={4}>
            Entre para ver suas ofertas e grupos
          </Typography>

          {/* Formulário */}
          <Card sx={{ bgcolor: 'background.paper', mb: 3 }}>
            <CardContent sx={{ p: '28px !important' }}>
              {error && (
                <Alert severity="error" sx={{ mb: 3 }}>
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
                  sx={{ mb: 2 }}
                />
                <TextField
                  label="Senha"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  fullWidth
                  required
                  autoComplete="current-password"
                  sx={{ mb: 3 }}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          onClick={() => setShowPassword((v) => !v)}
                          edge="end"
                          size="small"
                        >
                          {showPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                        </IconButton>
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
                  sx={{ py: 1.25 }}
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

          <Typography variant="caption" color="text.disabled" display="block" textAlign="center" mt={3}>
            © {new Date().getFullYear()} {APP_NAME} · Todos os direitos reservados
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

