import { Avatar, Box, Button, Tooltip, Typography, useTheme } from '@mui/material';
import { Loader, Smartphone, Wifi, WifiOff, type LucideIcon } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import { AppIcon } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { sessionStrings } from '@/features/sessions/strings';
import { formatBrazilPhone } from '@/features/sessions/utils';
import type { SessionItem, SessionStatus } from '@/types/api.types';
import { INNER_RADIUS, toneMain, toneSurface, toneText, type MonitorTone } from '../monitoringStyle';
import { monitoringStrings } from '../strings';
import { MonitorCard } from './MonitorCard';

const t = monitoringStrings.session;

export const SESSION_STATUS_TONE: Record<SessionStatus, MonitorTone> = {
  CONNECTED: 'success',
  CONNECTING: 'warning',
  AWAITING_QR: 'warning',
  AWAITING_PAIRING: 'warning',
  PENDING: 'neutral',
  DISCONNECTED: 'neutral',
  LOGGED_OUT: 'error',
  FAILED: 'error',
};

const STATUS_ICON: Record<MonitorTone, LucideIcon> = {
  success: Wifi, warning: Loader, neutral: WifiOff, error: WifiOff, info: Loader, primary: Wifi,
};

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
function formatWhen(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : dateTime.format(d);
}

/** Sessão escolhida: foto com anel de status, nome, número, status e atalho para a tela de sessões. */
export function SessionSummaryCard({ session }: { session: SessionItem }) {
  const theme = useTheme();
  const blurName = useBlur('monitoring.sessionName');
  const blurAvatar = useBlur('monitoring.sessionAvatar');
  const connected = session.status === 'CONNECTED';
  const tone = SESSION_STATUS_TONE[session.status];
  const surface = toneSurface(theme, tone);
  const warn = toneSurface(theme, 'warning');
  const phone = formatBrazilPhone(session.phone ?? session.declaredPhone);
  const last = formatWhen(session.lastConnectedAt);

  return (
    <MonitorCard
      icon={Smartphone}
      title={t.title}
      subtitle={t.subtitle}
      footer={
        <Tooltip title={connected ? t.manageTooltip : t.connectTooltip} arrow describeChild>
          <Button size="small" variant={connected ? 'text' : 'contained'} component={RouterLink} to="/settings/sessions" sx={{ minHeight: 36 }}>
            {connected ? t.manage : t.connect}
          </Button>
        </Tooltip>
      }
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, minWidth: 0 }}>
        <Box aria-hidden sx={{ p: '2.5px', borderRadius: '50%', bgcolor: toneMain(theme, tone), flexShrink: 0 }}>
          <Avatar
            src={session.avatarUrl ?? undefined}
            alt=""
            sx={{
              // Fundo opaco (paper + tinta do tom): translúcido deixaria o anel verde vazar e apagar o ícone
              width: 56, height: 56, bgcolor: 'background.paper',
              backgroundImage: `linear-gradient(${surface.backgroundColor}, ${surface.backgroundColor})`,
              color: toneText(theme, tone),
              border: '2px solid', borderColor: 'background.paper',
              ...(blurAvatar && { filter: 'blur(10px)' }),
            }}
          >
            <AppIcon icon={Smartphone} size="md" />
          </Avatar>
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Blurred when={blurName} inline radius={6}>
            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700 }}>
              {session.name || monitoringStrings.page.untitledSession}
            </Typography>
          </Blurred>
          <Blurred when={blurName} inline radius={5}>
            <Typography variant="body2" color="text.secondary" noWrap sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {phone || t.noPhone}
            </Typography>
          </Blurred>
          <Box
            component="span"
            sx={{
              mt: 0.75, display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25, borderRadius: 999,
              typography: 'caption', fontWeight: 700, color: surface.color, bgcolor: surface.backgroundColor,
            }}
          >
            <AppIcon icon={STATUS_ICON[tone]} size="inline" />
            {sessionStrings.status[session.status]}
          </Box>
        </Box>
      </Box>

      {last && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1.5, fontVariantNumeric: 'tabular-nums' }}>
          {t.lastConnected(last)}
        </Typography>
      )}

      {(tone === 'neutral' || tone === 'error') && (
        <Box
          sx={{
            mt: 1.5, px: 1.5, py: 1, borderRadius: INNER_RADIUS, border: '1px solid',
            borderColor: warn.borderColor, bgcolor: warn.backgroundColor,
          }}
        >
          <Typography variant="body2" sx={{ color: warn.color }}>{t.disconnectedHint}</Typography>
        </Box>
      )}
    </MonitorCard>
  );
}
