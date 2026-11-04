import { useState } from 'react';
import { Alert, Box, Button, CircularProgress, Link, TextField, Typography, alpha, useTheme } from '@mui/material';
import { KeyRound, Send } from 'lucide-react';
import { AppIcon, CooldownBar } from '@/components';
import { sessionStrings } from '../strings';
import { TELEGRAM_CODE_LENGTH, formatInternationalPhone, onlyDigits } from '../utils';
import type { SessionConnection } from '../hooks/useSessionConnection';
import type { TelegramLogin } from '../hooks/useTelegramLogin';
import { SessionConnectPanel } from './SessionConnectPanel';

const t = sessionStrings.telegram.connect;

interface Props {
  conn: SessionConnection;
  login: TelegramLogin;
  /** Telefone informado na criação, para o texto "código enviado para…". */
  phone?: string | null;
}

/**
 * Passo "Conecte seu Telegram": padrão por código (enviar → digitar → senha se a conta tiver),
 * com link para o QR (`SessionConnectPanel` em modo Telegram) e volta.
 */
export function TelegramConnectPanel({ conn, login, phone }: Props) {
  const theme = useTheme();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');

  if (conn.mode === 'qr') {
    return <SessionConnectPanel conn={conn} channel="telegram" onUseCode={conn.switchToCode} />;
  }

  const floodActive = Boolean(login.flood);
  const canSend = !login.busy && !floodActive && !login.resend;
  const codeReady = onlyDigits(code).length === TELEGRAM_CODE_LENGTH;

  const floodBanner = login.flood && (
    <Alert severity="warning" icon={false}>
      <CooldownBar
        startAt={login.flood.startAt}
        endAt={login.flood.endAt}
        ariaLabel={t.floodWaitAria}
        label={t.floodWait(Math.max(1, Math.ceil((login.flood.endAt - login.flood.startAt) / 60_000)))}
        doneLabel={t.floodWaitDone}
        onComplete={login.clearFlood}
        size="small"
      />
    </Alert>
  );

  return (
    <Box sx={{ display: 'grid', gap: 2.5 }}>
      <Typography variant="h6" component="h2" fontWeight={700}>{t.title}</Typography>
      {login.error && <Alert severity="error">{login.error}</Alert>}
      {floodBanner}

      {login.phase === 'idle' && (
        <Box
          sx={{
            display: 'flex', gap: 1.5, p: 2, borderRadius: 2,
            bgcolor: alpha(theme.palette.info.main, 0.08),
            border: '1px solid', borderColor: alpha(theme.palette.info.main, 0.25),
          }}
        >
          <Box sx={{ color: 'info.main', mt: 0.25, display: 'flex' }}><AppIcon icon={Send} size="md" /></Box>
          <Typography variant="body2" color="text.secondary">{t.codeIntro}</Typography>
        </Box>
      )}

      {login.phase === 'password' ? (
        <Box
          component="form"
          noValidate
          onSubmit={(e) => { e.preventDefault(); if (password) void login.submitPassword(password); }}
          sx={{ display: 'grid', gap: 2 }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ color: 'warning.main', display: 'flex' }}><AppIcon icon={KeyRound} size="md" /></Box>
            <Typography variant="subtitle2">{t.passwordTitle}</Typography>
          </Box>
          <TextField
            label={t.passwordLabel}
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); login.clearPasswordError(); }}
            autoFocus
            fullWidth
            autoComplete="current-password"
            disabled={login.busy !== null}
            error={Boolean(login.passwordError)}
            helperText={login.passwordError ?? t.passwordHelper}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={!password || login.busy !== null}
            startIcon={login.busy === 'password' ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {login.busy === 'password' ? t.checking : t.passwordSubmit}
          </Button>
        </Box>
      ) : login.phase === 'code' ? (
        <Box
          component="form"
          noValidate
          onSubmit={(e) => { e.preventDefault(); if (codeReady) void login.signIn(onlyDigits(code)); }}
          sx={{ display: 'grid', gap: 2 }}
        >
          {phone && <Typography variant="body2" color="text.secondary">{t.sentTo(formatInternationalPhone(phone))}</Typography>}
          <TextField
            label={t.codeLabel}
            value={code}
            onChange={(e) => { setCode(onlyDigits(e.target.value).slice(0, TELEGRAM_CODE_LENGTH)); login.clearCodeError(); }}
            autoFocus
            fullWidth
            autoComplete="one-time-code"
            inputProps={{ inputMode: 'numeric', maxLength: TELEGRAM_CODE_LENGTH, style: { letterSpacing: 6, fontSize: 24, textAlign: 'center' } }}
            disabled={login.busy !== null}
            error={Boolean(login.codeError)}
            helperText={login.codeError ?? t.codeHelper(TELEGRAM_CODE_LENGTH)}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={!codeReady || login.busy !== null}
            startIcon={login.busy === 'signIn' ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {login.busy === 'signIn' ? t.checking : t.signIn}
          </Button>
          <Box sx={{ display: 'grid', justifyItems: 'center', gap: 1 }}>
            {login.resend ? (
              <Box sx={{ width: '100%', maxWidth: 280 }}>
                <CooldownBar
                  startAt={login.resend.startAt}
                  endAt={login.resend.endAt}
                  ariaLabel={t.resendAria}
                  formatRemaining={(s) => t.resendIn(s)}
                  onComplete={login.clearResend}
                  size="small"
                />
              </Box>
            ) : (
              <Button size="small" onClick={() => void login.sendCode()} disabled={!canSend}>
                {login.busy === 'send' ? t.sending : t.resend}
              </Button>
            )}
          </Box>
        </Box>
      ) : (
        <Button
          variant="contained"
          size="large"
          onClick={() => void login.sendCode()}
          disabled={!canSend}
          startIcon={login.busy === 'send' ? <CircularProgress size={16} color="inherit" /> : <AppIcon icon={Send} />}
        >
          {login.busy === 'send' ? t.sending : t.sendCode}
        </Button>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
        <Link
          component="button"
          type="button"
          variant="body2"
          onClick={() => conn.switchToQr()}
          disabled={login.busy !== null || conn.busy}
          sx={{ fontWeight: 600 }}
        >
          {t.useQr}
        </Link>
      </Box>
    </Box>
  );
}
