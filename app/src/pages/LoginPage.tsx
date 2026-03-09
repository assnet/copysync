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

const DEV_CREDENTIALS = [
  { label: 'Super Admin', email: 'admin@washoot.dev', password: 'admin123' },
] as const;

const IS_DEV = import.meta.env.DEV;

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
      {/* Bloco decorativo lateral esquerdo */}
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          justifyContent: 'center',
          p: 8,
          width: '45%',
          flexShrink: 0,
          background: `linear-gradient(145deg, ${theme.palette.primary.dark} 0%, ${theme.palette.secondary.main} 100%)`,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Círculos decorativos */}
        <Box
          sx={{
            position: 'absolute', top: -80, right: -80,
            width: 300, height: 300, borderRadius: '50%',
            bgcolor: alpha('#fff', 0.06),
          }}
        />
        <Box
          sx={{
            position: 'absolute', bottom: -60, left: -60,
            width: 240, height: 240, borderRadius: '50%',
            bgcolor: alpha('#fff', 0.05),
          }}
        />

        <Box sx={{ position: 'relative', zIndex: 1 }}>
          {/* Logo */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 6 }}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: '14px',
                bgcolor: alpha('#fff', 0.2),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Typography sx={{ color: '#fff', fontWeight: 900, fontSize: 22, lineHeight: 1 }}>W</Typography>
            </Box>
            <Typography variant="h5" sx={{ color: '#fff', fontWeight: 800, letterSpacing: -0.5 }}>
              Washoot
            </Typography>
          </Box>

          <Typography variant="h4" sx={{ color: '#fff', mb: 2, maxWidth: 360 }}>
            Gerencie sua comunicação em um só lugar
          </Typography>
          <Typography sx={{ color: alpha('#fff', 0.75), lineHeight: 1.7, maxWidth: 340, fontSize: '0.95rem' }}>
            Sessões WhatsApp, chatbots, automações e métricas em tempo real para o seu negócio.
          </Typography>

          {/* Features */}
          <Stack spacing={1.5} sx={{ mt: 5 }}>
            {[
              'Multi-sessões WhatsApp',
              'Chatbots e automações',
              'Flows visuais por blocos',
              'Métricas em tempo real',
            ].map((feat) => (
              <Box key={feat} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Box
                  sx={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    bgcolor: alpha('#fff', 0.2),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Typography sx={{ color: '#fff', fontSize: 11, fontWeight: 700, lineHeight: 1 }}>✓</Typography>
                </Box>
                <Typography sx={{ color: alpha('#fff', 0.85), fontSize: '0.875rem' }}>{feat}</Typography>
              </Box>
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
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #4f70e0 0%, #7c3aed 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Typography sx={{ color: '#fff', fontWeight: 900, fontSize: 20, lineHeight: 1 }}>W</Typography>
            </Box>
            <Typography variant="h5" fontWeight={800} letterSpacing={-0.5}>Washoot</Typography>
          </Box>

          <Typography variant="h5" fontWeight={700} mb={0.5}>
            Bem-vindo de volta
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={4}>
            Entre na sua conta para continuar
          </Typography>

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

          {/* Formulário */}
          <Card sx={{ bgcolor: 'background.paper' }}>
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

          <Typography variant="caption" color="text.disabled" display="block" textAlign="center" mt={3}>
            © {new Date().getFullYear()} Washoot · Todos os direitos reservados
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

