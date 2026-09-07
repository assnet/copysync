import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Grid, Button, Chip, Avatar, alpha, useTheme,
} from '@mui/material';
import DevicesIcon from '@mui/icons-material/Devices';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { sessionService } from '@/services/session.service';
import { StatCard, SectionCard } from '@/components';
import { SessionStatusChip } from '@/features/sessions/components/SessionStatusChip';
import { formatPhone } from '@/features/chat/utils';
import type { SessionItem } from '@/types/api.types';

export function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeTenantName } = useTenant();
  const theme = useTheme();

  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sessionService
      .list()
      .then((r) => setSessions(r.sessions ?? []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  const total = sessions.length;
  const connected = sessions.filter((s) => s.status === 'CONNECTED').length;
  const waiting = sessions.filter(
    (s) => s.status === 'AWAITING_QR' || s.status === 'AWAITING_PAIRING' || s.status === 'CONNECTING',
  ).length;
  const errors = sessions.filter(
    (s) => s.status === 'DISCONNECTED' || s.status === 'FAILED' || s.status === 'LOGGED_OUT',
  ).length;

  const firstName = user?.name?.split(' ')[0] ?? 'usuário';

  // Saudação por hora
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
          <Typography variant="h5">
            {greeting}, {firstName} 👋
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Tenant ativo:
          </Typography>
          {activeTenantName ? (
            <Chip label={activeTenantName} size="small" color="primary" variant="outlined" />
          ) : (
            <Typography variant="body2" color="text.disabled">Nenhum tenant selecionado</Typography>
          )}
        </Box>
      </Box>

      {/* Stats */}
      <Grid container spacing={2.5} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} lg={3}>
          <StatCard
            label="Total de sessões"
            value={loading ? null : total}
            icon={<DevicesIcon />}
            accentColor={theme.palette.primary.main}
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatCard
            label="Conectadas"
            value={loading ? null : connected}
            icon={<CheckCircleOutlineIcon />}
            accentColor={theme.palette.success.main}
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatCard
            label="Aguardando"
            value={loading ? null : waiting}
            icon={<HourglassEmptyIcon />}
            accentColor={theme.palette.warning.main}
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatCard
            label="Com problemas"
            value={loading ? null : errors}
            icon={<ErrorOutlineIcon />}
            accentColor={theme.palette.error.main}
          />
        </Grid>
      </Grid>

      {/* Quick actions */}
      <Grid container spacing={2.5}>
        <Grid item xs={12} md={7}>
          <SectionCard
            title="Sessões WhatsApp"
            subtitle="Gerencie conexões e QR codes em tempo real"
            action={
              <Button
                size="small"
                variant="contained"
                endIcon={<ArrowForwardIcon />}
                onClick={() => navigate('/sessions')}
              >
                Gerenciar
              </Button>
            }
          >
            {loading ? (
              <Typography variant="body2" color="text.secondary">Carregando…</Typography>
            ) : total === 0 ? (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Typography variant="body2" color="text.secondary" mb={2}>
                  Nenhuma sessão criada ainda.
                </Typography>
                <Button variant="outlined" size="small" onClick={() => navigate('/sessions')}>
                  Criar primeira sessão
                </Button>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {sessions.slice(0, 5).map((s) => (
                  <Box
                    key={s.id}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      px: 1.5,
                      py: 1,
                      borderRadius: 2,
                      bgcolor: 'action.hover',
                      gap: 1,
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                      {/* Avatar com o ponto de status sobreposto: identidade da conexão,
                          como num chat, mas com o estado sempre visível */}
                      <Box sx={{ position: 'relative', flexShrink: 0 }}>
                        <Avatar
                          src={s.avatarUrl ?? undefined}
                          sx={{ width: 36, height: 36, fontSize: 14, fontWeight: 700 }}
                        >
                          {s.name[0]?.toUpperCase() ?? '?'}
                        </Avatar>
                        <Box
                          sx={{
                            position: 'absolute',
                            bottom: -1,
                            right: -1,
                            width: 11,
                            height: 11,
                            borderRadius: '50%',
                            border: '2px solid',
                            borderColor: 'background.paper',
                            bgcolor:
                              s.status === 'CONNECTED'
                                ? 'success.main'
                                : s.status === 'AWAITING_QR' || s.status === 'CONNECTING' || s.status === 'AWAITING_PAIRING'
                                ? 'warning.main'
                                : 'error.main',
                          }}
                        />
                      </Box>
                      {/* Nome acima, número abaixo — centrados na linha média do avatar */}
                      <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                        <Typography variant="body2" fontWeight={600} noWrap sx={{ lineHeight: 1.3 }}>
                          {s.name}
                        </Typography>
                        {s.phone && (
                          <Typography variant="caption" color="text.secondary" noWrap sx={{ lineHeight: 1.3 }}>
                            {formatPhone(s.phone)}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                    <SessionStatusChip status={s.status} />
                  </Box>
                ))}
                {total > 5 && (
                  <Button size="small" sx={{ alignSelf: 'flex-start', mt: 0.5 }} onClick={() => navigate('/sessions')}>
                    Ver todas ({total})
                  </Button>
                )}
              </Box>
            )}
          </SectionCard>
        </Grid>

        {/* Próximos módulos */}
        <Grid item xs={12} md={5}>
          <SectionCard title="Próximos módulos" subtitle="Em desenvolvimento">
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {[
                { name: 'Chatbots', desc: 'Respostas automáticas por regras' },
                { name: 'Flows visuais', desc: 'Construtor de fluxos por blocos' },
                { name: 'Campanhas', desc: 'Envios em massa programados' },
                { name: 'Assistentes IA', desc: 'Integração com modelos de linguagem' },
                { name: 'Métricas', desc: 'Dashboards e relatórios em tempo real' },
              ].map((mod) => (
                <Box
                  key={mod.name}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    px: 1.5,
                    py: 1,
                    borderRadius: 2,
                    bgcolor: 'action.hover',
                    gap: 1,
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={500}>{mod.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{mod.desc}</Typography>
                  </Box>
                  <Chip
                    label="Em breve"
                    size="small"
                    sx={{
                      fontSize: 10,
                      height: 20,
                      flexShrink: 0,
                      bgcolor: alpha(theme.palette.primary.main, 0.1),
                      color: 'primary.main',
                    }}
                  />
                </Box>
              ))}
            </Box>
          </SectionCard>
        </Grid>
      </Grid>
    </Box>
  );
}

