import { useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, IconButton, InputAdornment, Link, TextField, Tooltip, Typography, useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Eye, EyeOff, KeyRound, Send, ShieldCheck } from 'lucide-react';
import { AppIcon, CooldownBar } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { sessionStrings } from '../strings';
import { TELEGRAM_CODE_LENGTH, formatInternationalPhone, onlyDigits } from '../utils';
import { brand, focusRing } from '../sessionWizardStyle';
import type { SessionConnection } from '../hooks/useSessionConnection';
import type { TelegramLogin } from '../hooks/useTelegramLogin';
import { SessionConnectPanel } from './SessionConnectPanel';
import { ChannelBridge } from './ChannelBridge';

const t = sessionStrings.telegram.connect;
const CHANNEL = 'telegram' as const;
const PHONE_SLOT = '\u0000';

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
  const blurPhone = useBlur('sessions.sessionPhone');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  if (conn.mode === 'qr') {
    return <SessionConnectPanel conn={conn} channel={CHANNEL} onUseCode={conn.switchToCode} />;
  }

  const color = brand(theme, CHANNEL);
  const floodActive = Boolean(login.flood);
  const canSend = !login.busy && !floodActive && !login.resend;
  const codeReady = onlyDigits(code).length === TELEGRAM_CODE_LENGTH;
  const [sentBefore, sentAfter = ''] = t.sentTo(PHONE_SLOT).split(PHONE_SLOT);

  const floodBanner = login.flood && (
    // Texto fora do CooldownBar: o rótulo dele é `noWrap` e estourava a largura no celular.
    <Alert severity="warning" icon={false} sx={{ '& .MuiAlert-message': { flex: 1, minWidth: 0 } }}>
      <Typography variant="body2" sx={{ mb: 0.5 }}>
        {t.floodWait(Math.max(1, Math.ceil((login.flood.endAt - login.flood.startAt) / 60_000)))}
      </Typography>
      <CooldownBar
        startAt={login.flood.startAt}
        endAt={login.flood.endAt}
        ariaLabel={t.floodWaitAria}
        doneLabel={t.floodWaitDone}
        onComplete={login.clearFlood}
        size="small"
      />
    </Alert>
  );

  const bigButton = { minHeight: 48, '&.Mui-focusVisible': focusRing(theme, CHANNEL) } as const;

  return (
    <Box sx={{ display: 'grid', gap: 2.5 }}>
      <Typography variant="h6" component="h2" fontWeight={700} textAlign={login.phase === 'idle' ? 'center' : 'left'}>
        {t.title}
      </Typography>
      {login.error && <Alert severity="error">{login.error}</Alert>}
      {floodBanner}

      {login.phase === 'password' ? (
        <Box
          component="form"
          noValidate
          onSubmit={(e) => { e.preventDefault(); if (password) void login.submitPassword(password); }}
          sx={{ display: 'grid', gap: 2 }}
        >
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
            <Box
              aria-hidden
              sx={{
                width: 40, height: 40, borderRadius: 2, flexShrink: 0, display: 'grid', placeItems: 'center',
                bgcolor: alpha(theme.palette.warning.main, 0.14), color: 'warning.main',
              }}
            >
              <AppIcon icon={KeyRound} size="md" />
            </Box>
            <Box sx={{ display: 'grid', gap: 0.5 }}>
              <Typography variant="subtitle2" component="h3">{t.passwordTitle}</Typography>
              <Typography variant="body2" color="text.secondary">{t.passwordIntro}</Typography>
            </Box>
          </Box>
          <TextField
            label={t.passwordLabel}
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => { setPassword(e.target.value); login.clearPasswordError(); }}
            autoFocus
            fullWidth
            autoComplete="current-password"
            disabled={login.busy !== null}
            error={Boolean(login.passwordError)}
            helperText={login.passwordError ?? t.passwordHelper}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <Tooltip title={showPassword ? t.hidePassword : t.showPassword}>
                    <IconButton
                      aria-label={showPassword ? t.hidePassword : t.showPassword}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((v) => !v)}
                      onMouseDown={(e) => e.preventDefault()}
                      edge="end"
                      sx={{ width: 44, height: 44, '&.Mui-focusVisible': focusRing(theme, CHANNEL) }}
                    >
                      <AppIcon icon={showPassword ? EyeOff : Eye} size="sm" />
                    </IconButton>
                  </Tooltip>
                </InputAdornment>
              ),
            }}
          />
          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={!password || login.busy !== null}
            startIcon={login.busy === 'password' ? <CircularProgress size={16} color="inherit" /> : undefined}
            sx={bigButton}
          >
            {login.busy === 'password' ? t.checking : t.passwordSubmit}
          </Button>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', color: 'text.secondary' }}>
            <Box aria-hidden sx={{ display: 'flex', mt: '2px', color: 'success.main' }}>
              <AppIcon icon={ShieldCheck} size="sm" />
            </Box>
            <Typography variant="caption" color="text.secondary">{t.securityNote}</Typography>
          </Box>
        </Box>
      ) : login.phase === 'code' ? (
        <Box
          component="form"
          noValidate
          onSubmit={(e) => { e.preventDefault(); if (codeReady) void login.signIn(onlyDigits(code)); }}
          sx={{ display: 'grid', gap: 2 }}
        >
          {phone && (
            <Typography variant="body2" color="text.secondary">
              {sentBefore}
              <Blurred when={blurPhone} inline>
                <Box component="span" sx={{ fontWeight: 600, color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
                  {formatInternationalPhone(phone)}
                </Box>
              </Blurred>
              {sentAfter}
            </Typography>
          )}
          <TextField
            label={t.codeLabel}
            value={code}
            onChange={(e) => { setCode(onlyDigits(e.target.value).slice(0, TELEGRAM_CODE_LENGTH)); login.clearCodeError(); }}
            autoFocus
            fullWidth
            autoComplete="one-time-code"
            inputProps={{ inputMode: 'numeric', pattern: '[0-9]*', maxLength: TELEGRAM_CODE_LENGTH }}
            disabled={login.busy !== null}
            error={Boolean(login.codeError)}
            helperText={login.codeError ?? t.codeHelper(TELEGRAM_CODE_LENGTH)}
            sx={{
              '& .MuiInputBase-input': {
                fontSize: 28, letterSpacing: 10, textAlign: 'center', fontVariantNumeric: 'tabular-nums',
                fontWeight: 600, py: 1.75,
              },
              ...(!code && !login.codeError && {
                '& .MuiOutlinedInput-notchedOutline': { borderColor: alpha(color, 0.4) },
              }),
              '& .MuiOutlinedInput-root.Mui-focused:not(.Mui-error) .MuiOutlinedInput-notchedOutline': { borderColor: color },
              '& .MuiInputLabel-root.Mui-focused:not(.Mui-error)': { color },
            }}
          />
          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={!codeReady || login.busy !== null}
            startIcon={login.busy === 'signIn' ? <CircularProgress size={16} color="inherit" /> : undefined}
            sx={bigButton}
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
              <Button onClick={() => void login.sendCode()} disabled={!canSend} sx={{ minHeight: 44 }}>
                {login.busy === 'send' ? t.sending : t.resend}
              </Button>
            )}
          </Box>
        </Box>
      ) : (
        <Box sx={{ display: 'grid', justifyItems: 'center', gap: 2.5, pt: 1 }}>
          <ChannelBridge channel={CHANNEL} state="idle" />
          <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ maxWidth: 420 }}>
            {t.codeIntro}
          </Typography>
          <Button
            variant="contained"
            size="large"
            fullWidth
            onClick={() => void login.sendCode()}
            disabled={!canSend}
            startIcon={login.busy === 'send' ? <CircularProgress size={16} color="inherit" /> : <AppIcon icon={Send} size="md" />}
            sx={bigButton}
          >
            {login.busy === 'send' ? t.sending : t.sendCode}
          </Button>
        </Box>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
        <Link
          component="button"
          type="button"
          variant="body2"
          onClick={() => conn.switchToQr()}
          disabled={login.busy !== null || conn.busy}
          sx={{ fontWeight: 600, minHeight: 44, px: 1, borderRadius: 1, '&:focus-visible': focusRing(theme, CHANNEL) }}
        >
          {t.useQr}
        </Link>
      </Box>
    </Box>
  );
}
