import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, Card, CardContent, Grid, Skeleton, Button } from '@mui/material';
import DevicesIcon from '@mui/icons-material/Devices';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { sessionService } from '@/services/session.service';
import type { SessionItem } from '@/types/api.types';

export function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeTenantName } = useTenant();

  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sessionService
      .list()
      .then((r) => setSessions(r.sessions ?? []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  const connected = sessions.filter((s) => s.status === 'CONNECTED').length;
  const disconnected = sessions.filter(
    (s) => s.status === 'DISCONNECTED' || s.status === 'FAILED' || s.status === 'LOGGED_OUT',
  ).length;

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h5">
          Olá, {user?.name?.split(' ')[0] ?? 'usuário'} 👋
        </Typography>
        <Typography variant="body2" color="text.secondary" mt={0.5}>
          {activeTenantName ? `Tenant: ${activeTenantName}` : 'Nenhum tenant ativo'}
        </Typography>
      </Box>

      {/* Cards de resumo */}
      <Grid container spacing={2} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={4}>
          <StatCard
            label="Total de sessões"
            value={loading ? null : sessions.length}
            icon={<DevicesIcon fontSize="large" color="primary" />}
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <StatCard
            label="Conectadas"
            value={loading ? null : connected}
            icon={<CheckCircleIcon fontSize="large" color="success" />}
            color="success.main"
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <StatCard
            label="Desconectadas / com erro"
            value={loading ? null : disconnected}
            icon={<ErrorIcon fontSize="large" color="error" />}
            color="error.main"
          />
        </Grid>
      </Grid>

      {/* Atalho */}
      <Card>
        <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
          <Box>
            <Typography variant="subtitle1">Sessões WhatsApp</Typography>
            <Typography variant="body2" color="text.secondary">
              Gerencie suas conexões, QR codes e status em tempo real.
            </Typography>
          </Box>
          <Button variant="contained" onClick={() => navigate('/sessions')}>
            Gerenciar sessões
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
}

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number | null;
  icon: React.ReactNode;
  color?: string;
}) {
  return (
    <Card>
      <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {icon}
        <Box>
          <Typography variant="body2" color="text.secondary">
            {label}
          </Typography>
          {value === null ? (
            <Skeleton width={40} height={32} />
          ) : (
            <Typography variant="h5" fontWeight={700} color={color ?? 'text.primary'}>
              {value}
            </Typography>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
