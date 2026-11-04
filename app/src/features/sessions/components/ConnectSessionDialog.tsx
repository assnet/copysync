import { Box, Button } from '@mui/material';
import { Blurred, useBlur } from '@/features/privacy';
import type { SessionItem, SessionStatus } from '@/types/api.types';
import { sessionStrings } from '../strings';
import { TELEGRAM_QR_TTL_MS, channelOf, isTelegramSession } from '../utils';
import { useSessionConnection } from '../hooks/useSessionConnection';
import { useTelegramLogin } from '../hooks/useTelegramLogin';
import { SessionConnectPanel } from './SessionConnectPanel';
import { TelegramConnectPanel } from './TelegramConnectPanel';
import { SessionConnectedPanel } from './SessionConnectedPanel';
import { SessionStatusChip } from './SessionStatusChip';
import { SessionWizardDialog } from './SessionWizardDialog';

interface Props {
  session: SessionItem | null;
  open: boolean;
  onClose: () => void;
  onStatusChange?: (sessionId: string, status: SessionStatus) => void;
}

/** Conectar/reconectar uma sessão existente — mesmo passo de conexão do assistente, por canal. */
export function ConnectSessionDialog({ session, open, onClose, onStatusChange }: Props) {
  const telegram = session ? isTelegramSession(session) : false;
  const channel = channelOf(session?.engine);
  const blurName = useBlur('sessions.sessionName');
  // Telegram: o cartão já disparou connect/reconnect (login por QR) → abre em QR; a partir de
  // AWAITING_CODE/PASSWORD (login por código em andamento) abre no código.
  const openedByCode = session?.status === 'AWAITING_CODE' || session?.status === 'AWAITING_PASSWORD';
  const conn = useSessionConnection({
    sessionId: session?.id ?? null,
    enabled: open,
    onStatusChange,
    qrTtlMs: telegram ? TELEGRAM_QR_TTL_MS : undefined,
    initialMode: telegram && openedByCode ? 'code' : 'qr',
  });
  const login = useTelegramLogin(open && telegram ? session?.id ?? null : null, conn);
  const status = conn.status ?? session?.status ?? null;

  return (
    <SessionWizardDialog
      open={open}
      onClose={onClose}
      channel={channel}
      title={
        <Blurred when={blurName} inline>{sessionStrings.connect.dialogTitle(session?.name ?? '')}</Blurred>
      }
      subtitle={status ? <Box sx={{ mt: 0.5 }}><SessionStatusChip status={status} /></Box> : undefined}
      actions={
        <Button variant={conn.isConnected ? 'contained' : 'text'} onClick={onClose}>
          {conn.isConnected ? sessionStrings.wizard.finish : sessionStrings.wizard.close}
        </Button>
      }
    >
      {conn.isConnected
        ? <SessionConnectedPanel session={conn.session ?? session} channel={channel} onDone={onClose} />
        : telegram
          ? <TelegramConnectPanel conn={conn} login={login} phone={session?.declaredPhone} />
          : <SessionConnectPanel conn={conn} channel={channel} />}
    </SessionWizardDialog>
  );
}
