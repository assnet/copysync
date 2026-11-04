import { Box, Typography, Alert, Button, alpha, useTheme } from '@mui/material';
import { ArrowRight, CircleCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppIcon } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import type { SessionItem } from '@/types/api.types';
import { sessionStrings } from '../strings';
import { channelOf, formatInternationalPhone, type SessionChannel } from '../utils';
import { REDUCED_MOTION, brand, focusRing, ring } from '../sessionWizardStyle';
import { CHANNEL_ICON } from './SessionChannelChip';

const t = sessionStrings.done;
const tg = sessionStrings.telegram.done;

interface Props {
  session: SessionItem | null;
  /** Sem `session` ainda (carregando), define os textos; com ela, vem do `engine`. */
  channel?: SessionChannel;
  /**
   * Fecha o assistente. Com ele (e só no WhatsApp) aparecem "Ir para o Monitoramento"
   * (fecha e navega para `/monitoring`) e "Fazer isso depois" (só fecha).
   */
  onDone?: () => void;
}

/** Passo final: confirma a conexão e avisa quando a conta conectada não é a informada. */
export function SessionConnectedPanel({ session, channel, onDone }: Props) {
  const theme = useTheme();
  const navigate = useNavigate();
  const ch: SessionChannel = session ? channelOf(session.engine) : channel ?? 'whatsapp';
  const telegram = ch === 'telegram';
  const color = brand(theme, ch);
  const success = theme.palette.success.main;
  const blurPhone = useBlur('sessions.sessionPhone');
  const phone = session?.phone ? formatInternationalPhone(session.phone) : null;
  const copy = telegram ? tg : t;

  const ringSx = {
    position: 'absolute', inset: 0, borderRadius: '50%', pointerEvents: 'none',
    border: `2px solid ${alpha(success, 0.5)}`, opacity: 0,
    animation: `${ring} 900ms ease-out 2 both`,
    [REDUCED_MOTION]: { display: 'none' },
  } as const;

  return (
    <Box sx={{ display: 'grid', justifyItems: 'center', textAlign: 'center', gap: 2.5, py: 2 }}>
      <Box role="status" sx={{ display: 'grid', justifyItems: 'center', gap: 2, width: '100%' }}>
        <Box sx={{ position: 'relative', width: 88, height: 88 }}>
          <Box aria-hidden sx={ringSx} />
          <Box aria-hidden sx={{ ...ringSx, animationDelay: '180ms' }} />
          <Box
            sx={{
              width: 88, height: 88, borderRadius: '50%', display: 'grid', placeItems: 'center',
              bgcolor: success, color: theme.palette.getContrastText(success),
              '& svg': { width: 48, height: 48 },
            }}
          >
            <AppIcon icon={CircleCheck} size="lg" />
          </Box>
          <Box
            aria-hidden
            sx={{
              position: 'absolute', right: -2, bottom: -2, width: 28, height: 28, borderRadius: '50%',
              display: 'grid', placeItems: 'center', boxSizing: 'content-box',
              bgcolor: 'background.paper', border: 2, borderColor: 'background.paper', color,
            }}
          >
            <AppIcon icon={CHANNEL_ICON[ch]} size="md" />
          </Box>
        </Box>

        <Box>
          <Typography variant="h6" component="h2" fontWeight={700}>{copy.title}</Typography>
          <Typography variant="body2" color="text.secondary" mt={0.5} sx={{ maxWidth: 420, mx: 'auto' }}>
            {copy.body}
          </Typography>
        </Box>

        {phone && (
          <Box
            sx={{
              px: 2.5, py: 1.25, borderRadius: 3,
              bgcolor: alpha(color, 0.08), border: `1px solid ${alpha(color, 0.2)}`,
            }}
          >
            <Typography variant="caption" color="text.secondary" display="block">{copy.connectedAs}</Typography>
            <Blurred when={blurPhone} inline>
              <Typography variant="subtitle1" fontWeight={700}>{phone}</Typography>
            </Blurred>
          </Box>
        )}

        {session?.phoneMismatch && (
          <Alert severity="warning" sx={{ textAlign: 'left', width: '100%' }}>
            {copy.mismatch(phone ?? '')}
          </Alert>
        )}
      </Box>

      {!telegram && onDone && (
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1, width: { xs: '100%', sm: 'auto' } }}>
          <Button
            variant="contained"
            size="large"
            endIcon={<AppIcon icon={ArrowRight} size="md" />}
            onClick={() => { onDone(); navigate('/monitoring'); }}
            sx={{ minHeight: 44, '&:focus-visible': focusRing(theme, ch) }}
          >
            {t.nextMonitoring}
          </Button>
          <Button
            size="large"
            onClick={onDone}
            sx={{ minHeight: 44, '&:focus-visible': focusRing(theme, ch) }}
          >
            {t.nextLater}
          </Button>
        </Box>
      )}
    </Box>
  );
}
