import { useState } from 'react';
import {
  Box, Typography, Button, CircularProgress, LinearProgress, Alert, IconButton, Tooltip,
  Link, alpha, useTheme,
} from '@mui/material';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { AppIcon } from '@/components';
import { sessionStrings } from '../strings';
import { formatCountdown, formatPairingCode, type SessionChannel } from '../utils';
import type { SessionConnection } from '../hooks/useSessionConnection';
import { brand, focusRing } from '../sessionWizardStyle';
import { ChannelBridge } from './ChannelBridge';

const t = sessionStrings.connect;
const tg = sessionStrings.telegram.connect;

interface Props {
  conn: SessionConnection;
  /** Cor/logo da ponte e do QR; muda título, passos e o link alternativo (Telegram: "Prefiro receber um código"). */
  channel?: SessionChannel;
  /** Telegram: voltar ao login por código. */
  onUseCode?: () => void;
}

const QR_BOX = 236;

/** Passos numerados com a bolinha na cor do canal. */
function NumberedSteps({ items, channel }: { items: readonly string[]; channel: SessionChannel }) {
  return (
    <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 1.25 }}>
      {items.map((item, i) => (
        <Box component="li" key={item} sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Box
            aria-hidden
            sx={(th) => ({
              width: 24, height: 24, flexShrink: 0, borderRadius: '50%',
              display: 'grid', placeItems: 'center',
              bgcolor: alpha(brand(th, channel), 0.14),
              color: brand(th, channel), fontSize: 12, fontWeight: 700,
            })}
          >
            {i + 1}
          </Box>
          <Typography variant="body2">{item}</Typography>
        </Box>
      ))}
    </Box>
  );
}

/**
 * Quatro cantoneiras na cor do canal em volta do QR (moldura de "visor"), 6px para fora da caixa.
 * Só larguras por lado: o atalho `borderTop: 3` vira `3px solid` e troca a cor por `currentColor`.
 */
function QrCorners({ channel }: { channel: SessionChannel }) {
  const corners = [
    { top: -6, left: -6, borderTopWidth: 3, borderLeftWidth: 3 },
    { top: -6, right: -6, borderTopWidth: 3, borderRightWidth: 3 },
    { bottom: -6, left: -6, borderBottomWidth: 3, borderLeftWidth: 3 },
    { bottom: -6, right: -6, borderBottomWidth: 3, borderRightWidth: 3 },
  ];
  return (
    <>
      {corners.map((c, i) => (
        <Box
          key={i}
          aria-hidden
          sx={(th) => ({
            position: 'absolute', width: 22, height: 22, borderRadius: '6px',
            borderStyle: 'solid', borderWidth: 0, borderColor: brand(th, channel), ...c,
          })}
        />
      ))}
    </>
  );
}

/** Código de pareamento: uma "casa" por caractere, hífen como separador; lido como um todo. */
function PairingCode({ code, channel }: { code: string; channel: SessionChannel }) {
  const formatted = formatPairingCode(code);
  return (
    <Box
      role="group"
      aria-label={t.pairingAria(code.replace(/-/g, ''))}
      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: { xs: 0.5, sm: 0.75 }, flexWrap: 'wrap' }}
    >
      {formatted.split('').map((ch, i) => (ch === '-' ? (
        <Box key={i} aria-hidden sx={{ width: 10, height: 3, borderRadius: 2, bgcolor: 'text.disabled', mx: 0.25 }} />
      ) : (
        <Box
          key={i}
          aria-hidden
          sx={(th) => ({
            width: { xs: 30, sm: 36 }, height: { xs: 40, sm: 46 }, borderRadius: '10px',
            display: 'grid', placeItems: 'center',
            bgcolor: 'action.hover', border: `1px solid ${alpha(brand(th, channel), 0.3)}`,
            fontFamily: 'monospace', fontSize: { xs: 22, sm: 26 }, fontWeight: 700, lineHeight: 1,
          })}
        >
          {ch}
        </Box>
      )))}
    </Box>
  );
}

/**
 * Passo "Conecte": ponte celular ↔ canal, QR com contagem regressiva ou código de pareamento (WhatsApp).
 * Para o Telegram só o QR (`tg://login`, troca a cada 30 s) — o código fica em `TelegramConnectPanel`.
 */
export function SessionConnectPanel({ conn, channel = 'whatsapp', onUseCode }: Props) {
  const theme = useTheme();
  const telegram = channel === 'telegram';
  const color = brand(theme, channel);
  const [copied, setCopied] = useState(false);
  const {
    mode, qrCode, pairingCode, status, error, busy, isFailed, isConnected,
    secondsLeft, qrTtlSeconds, qrExpired,
  } = conn;

  const needsNewCode = !isConnected && (isFailed || (mode === 'qr' && qrExpired));
  const refreshingQr = !isConnected && mode === 'qr' && secondsLeft === 0 && !qrExpired && !isFailed;
  const linkSx = { fontWeight: 600, borderRadius: 1, minHeight: 44, px: 1, '&:focus-visible': focusRing(theme, channel) };

  async function copy() {
    if (!pairingCode) return;
    try {
      await navigator.clipboard.writeText(pairingCode.replace(/-/g, ''));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard bloqueado: o código continua visível para digitar */ }
  }

  const statusLine = (
    <Box
      role="status"
      aria-live="polite"
      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, color: 'text.secondary' }}
    >
      {!needsNewCode && <CircularProgress size={14} thickness={5} sx={{ color }} />}
      <Typography variant="body2">
        {status === 'LOGGED_OUT' ? t.loggedOut : isFailed ? t.failed : t.waiting}
      </Typography>
    </Box>
  );

  return (
    <Box sx={{ display: 'grid', gap: 2.5 }}>
      <Box sx={{ display: 'grid', justifyItems: 'center', textAlign: 'center', gap: 1.5 }}>
        <ChannelBridge channel={channel} state={needsNewCode ? 'idle' : 'waiting'} />
        <Box>
          <Typography variant="h6" component="h2" fontWeight={700}>{telegram ? tg.title : t.title}</Typography>
          {!telegram && (
            <Typography variant="body2" color="text.secondary" mt={0.5}>{t.subtitle}</Typography>
          )}
        </Box>
        {statusLine}
      </Box>

      {error && <Alert severity="error">{error}</Alert>}

      <Box
        sx={{
          display: 'grid', gap: 3, alignItems: 'center',
          gridTemplateColumns: { xs: '1fr', sm: mode === 'qr' ? '1fr auto' : '1fr' },
        }}
      >
        <NumberedSteps items={mode === 'qr' ? (telegram ? tg.qrSteps : t.qrSteps) : t.pairingSteps} channel={channel} />

        {/* Área do código */}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, minWidth: { sm: QR_BOX } }}>
          {mode === 'qr' ? (
            <>
              <Box
                sx={{
                  width: QR_BOX, height: QR_BOX, p: 1.5, borderRadius: 3, my: 0.75, // espaço das cantoneiras
                  // QR precisa de fundo claro para a câmera ler, em qualquer tema.
                  bgcolor: 'common.white',
                  display: 'grid', placeItems: 'center', position: 'relative',
                }}
              >
                <QrCorners channel={channel} />
                {qrCode && !needsNewCode ? (
                  <QRCodeSVG
                    value={qrCode}
                    size={200}
                    level="M"
                    fgColor={theme.palette.common.black}
                    bgColor={theme.palette.common.white}
                    role="img"
                    aria-label={telegram ? tg.qrAlt : t.qrAlt}
                  />
                ) : needsNewCode ? (
                  <Typography variant="body2" sx={{ color: 'grey.700', textAlign: 'center', px: 2 }}>
                    {t.expired}
                  </Typography>
                ) : (
                  <Box sx={{ display: 'grid', placeItems: 'center', gap: 1 }}>
                    <CircularProgress size={36} sx={{ color }} />
                    <Typography variant="caption" sx={{ color: 'grey.700' }}>{t.preparing}</Typography>
                  </Box>
                )}
              </Box>

              {qrCode && !needsNewCode && secondsLeft !== null && (
                <Box sx={{ width: QR_BOX }}>
                  <LinearProgress
                    variant={refreshingQr ? 'indeterminate' : 'determinate'}
                    value={(secondsLeft / qrTtlSeconds) * 100}
                    sx={{
                      height: 6, borderRadius: 3, bgcolor: alpha(color, 0.16),
                      '& .MuiLinearProgress-bar': {
                        borderRadius: 3,
                        bgcolor: secondsLeft <= 5 && !refreshingQr ? 'warning.main' : color,
                      },
                    }}
                  />
                  <Typography variant="caption" color="text.secondary" display="block" textAlign="center" mt={0.75}>
                    {refreshingQr ? t.refreshing : t.expiresIn(formatCountdown(secondsLeft))}
                  </Typography>
                </Box>
              )}
            </>
          ) : (
            <Box
              sx={{
                width: '100%', minHeight: 140, p: { xs: 2, sm: 2.5 }, borderRadius: 3, textAlign: 'center',
                border: '1px dashed', borderColor: alpha(color, 0.4),
                display: 'grid', placeItems: 'center', gap: 1.5,
              }}
            >
              <Typography variant="caption" color="text.secondary">{t.pairingTitle}</Typography>
              {pairingCode && !isFailed ? (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <PairingCode code={pairingCode} channel={channel} />
                  <Tooltip title={copied ? t.copied : t.copy}>
                    <IconButton
                      onClick={() => void copy()}
                      aria-label={t.copy}
                      color={copied ? 'success' : 'default'}
                      sx={{ width: 44, height: 44, '&:focus-visible': focusRing(theme, channel) }}
                    >
                      <AppIcon icon={copied ? Check : Copy} size="md" />
                    </IconButton>
                  </Tooltip>
                </Box>
              ) : !isFailed ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={18} sx={{ color }} />
                  <Typography variant="body2" color="text.secondary">{t.pairingLoading}</Typography>
                </Box>
              ) : null}
            </Box>
          )}
        </Box>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
        {needsNewCode && (
          <Button
            variant="contained"
            size="large"
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <AppIcon icon={RefreshCw} size="md" />}
            onClick={() => void conn.regenerate()}
            disabled={busy}
          >
            {t.regenerate}
          </Button>
        )}
        {telegram ? (
          onUseCode && (
            <Link component="button" type="button" variant="body2" onClick={onUseCode} disabled={busy} sx={linkSx}>
              {tg.useCode}
            </Link>
          )
        ) : (
          <Link
            component="button"
            type="button"
            variant="body2"
            onClick={() => void (mode === 'qr' ? conn.switchToPairing() : conn.switchToQr())}
            disabled={busy}
            sx={linkSx}
          >
            {mode === 'qr' ? t.usePairing : t.useQr}
          </Link>
        )}
      </Box>
    </Box>
  );
}
