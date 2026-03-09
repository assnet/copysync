import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  Alert,
  CircularProgress,
  InputAdornment,
  IconButton,
  Chip,
  Tooltip,
  Stack,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { useAuth } from '@/contexts/AuthContext';

const DEV_CREDENTIALS = [
  { label: 'Super Admin', email: 'admin@washoot.dev', password: 'admin123' },
] as const;

const IS_DEV = import.meta.env.DEV;
import { useTenant } from '@/contexts/TenantContext';

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { loadTenants } = useTenant();

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

      // Ativa o primeiro tenant automaticamente se disponível
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
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        p: 2,
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 400 }}>
        {/* Logo */}
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Typography variant="h4" color="primary" fontWeight={800} letterSpacing={-1}>
            Washoot
          </Typography>
          <Typography variant="body2" color="text.secondary" mt={0.5}>
            Entre na sua conta para continuar
          </Typography>
        </Box>

        {/* Card de credenciais — somente em desenvolvimento */}
        {IS_DEV && (
          <Card
            sx={{
              mb: 2,
              border: '1px dashed',
              borderColor: 'warning.main',
              bgcolor: 'warning.50',
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
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 1,
                      flexWrap: 'wrap',
                    }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" fontWeight={600} display="block">
                        {cred.label}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ fontFamily: 'monospace', fontSize: 11 }}
                      >
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
                        onClick={() => {
                          setEmail(cred.email);
                          setPassword(cred.password);
                        }}
                        sx={{ cursor: 'pointer', fontSize: 11 }}
                      />
                    </Tooltip>
                  </Box>
                ))}
              </Stack>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent sx={{ p: 3 }}>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
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
                        {showPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
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
              >
                {loading ? <CircularProgress size={22} color="inherit" /> : 'Entrar'}
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
