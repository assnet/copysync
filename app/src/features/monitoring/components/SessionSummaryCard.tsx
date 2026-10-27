import { Avatar, Box, Button, Chip, Stack, Tooltip, Typography, type ChipProps } from '@mui/material';
import { Smartphone } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import { AppIcon, SectionCard } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { sessionStrings } from '@/features/sessions/strings';
import { formatBrazilPhone } from '@/features/sessions/utils';
import type { SessionItem, SessionStatus } from '@/types/api.types';
import { monitoringStrings } from '../strings';

const t = monitoringStrings.session;

const STATUS_COLOR: Record<SessionStatus, ChipProps['color']> = {
  CONNECTED: 'success',
  CONNECTING: 'warning',
  AWAITING_QR: 'warning',
  AWAITING_PAIRING: 'warning',
  PENDING: 'default',
  DISCONNECTED: 'default',
  LOGGED_OUT: 'error',
  FAILED: 'error',
};

/** Sessão escolhida: foto, nome, número, status e atalho para conectar. */
export function SessionSummaryCard({ session }: { session: SessionItem }) {
  const blur = useBlur('monitoring.sessionName');
  const connected = session.status === 'CONNECTED';
  const phone = formatBrazilPhone(session.phone ?? session.declaredPhone);

  return (
    <SectionCard title={t.title} subtitle={t.subtitle} sx={{ height: '100%' }}>
      <Stack spacing={2}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
          <Avatar
            src={session.avatarUrl ?? undefined}
            alt=""
            sx={{ width: 48, height: 48, bgcolor: 'action.selected', color: 'text.secondary', ...(blur && { filter: 'blur(10px)' }) }}
          >
            <AppIcon icon={Smartphone} size="md" />
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Blurred when={blur} inline radius={6}>
              <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700 }}>
                {session.name || monitoringStrings.page.untitledSession}
              </Typography>
            </Blurred>
            <Blurred when={blur} inline radius={5}>
              <Typography variant="body2" color="text.secondary" noWrap sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {phone || t.noPhone}
              </Typography>
            </Blurred>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
          <Chip size="small" color={STATUS_COLOR[session.status]} label={sessionStrings.status[session.status]} />
          <Tooltip title={connected ? t.manageTooltip : t.connectTooltip} arrow describeChild>
            <Button size="small" variant={connected ? 'text' : 'contained'} component={RouterLink} to="/sessions">
              {connected ? t.manage : t.connect}
            </Button>
          </Tooltip>
        </Box>
      </Stack>
    </SectionCard>
  );
}
