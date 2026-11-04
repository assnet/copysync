import { Box, Typography, Alert, alpha } from '@mui/material';
import { CircleCheck } from 'lucide-react';
import { AppIcon } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import type { SessionItem } from '@/types/api.types';
import { sessionStrings } from '../strings';
import { channelOf, formatInternationalPhone, type SessionChannel } from '../utils';

const t = sessionStrings.done;
const tg = sessionStrings.telegram.done;

interface Props {
  session: SessionItem | null;
  /** Sem `session` ainda (carregando), define os textos; com ela, vem do `engine`. */
  channel?: SessionChannel;
}

/** Passo final: confirma a conexão e avisa quando a conta conectada não é a informada. */
export function SessionConnectedPanel({ session, channel }: Props) {
  const telegram = (session ? channelOf(session.engine) : channel) === 'telegram';
  const blurPhone = useBlur('sessions.sessionPhone');
  const phone = session?.phone ? formatInternationalPhone(session.phone) : null;
  const copy = telegram ? tg : t;

  return (
    <Box sx={{ display: 'grid', justifyItems: 'center', textAlign: 'center', gap: 2, py: 2 }}>
      <Box
        sx={{
          width: 72, height: 72, borderRadius: '50%', display: 'grid', placeItems: 'center',
          bgcolor: (th) => alpha(th.palette.success.main, 0.12), color: 'success.main',
          '& svg': { width: 44, height: 44 },
        }}
      >
        <AppIcon icon={CircleCheck} size="lg" />
      </Box>
      <Box>
        <Typography variant="h6" component="h2" fontWeight={700}>{t.title}</Typography>
        <Typography variant="body2" color="text.secondary" mt={0.5}>{copy.body}</Typography>
      </Box>

      {phone && (
        <Box sx={{ px: 2, py: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
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
  );
}
