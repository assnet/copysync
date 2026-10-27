import { useState } from 'react';
import {
  Box, Typography, Button, CircularProgress, LinearProgress, Alert, IconButton, Tooltip,
  Link, alpha, useTheme,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import RefreshIcon from '@mui/icons-material/Refresh';
import { QRCodeSVG } from 'qrcode.react';
import { sessionStrings } from '../strings';
import { formatCountdown, formatPairingCode } from '../utils';
import type { SessionConnection } from '../hooks/useSessionConnection';

const t = sessionStrings.connect;

function NumberedSteps({ items }: { items: readonly string[] }) {
  return (
    <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 1 }}>
      {items.map((item, i) => (
        <Box component="li" key={item} sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Box
            aria-hidden
            sx={{
              width: 24, height: 24, flexShrink: 0, borderRadius: '50%',
              display: 'grid', placeItems: 'center',
              bgcolor: (th) => alpha(th.palette.primary.main, 0.12),
              color: 'primary.main', fontSize: 12, fontWeight: 700,
            }}
          >
            {i + 1}
          </Box>
          <Typography variant="body2">{item}</Typography>
        </Box>
      ))}
    </Box>
  );
}

/** Passo "Conecte seu WhatsApp": QR com contagem regressiva ou código de pareamento. */
export function SessionConnectPanel({ conn }: { conn: SessionConnection }) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const {
    mode, qrCode, pairingCode, status, error, busy, isFailed, isConnected,
    secondsLeft, qrTtlSeconds, qrExpired,
  } = conn;

  const needsNewCode = !isConnected && (isFailed || (mode === 'qr' && qrExpired));
  const refreshingQr = !isConnected && mode === 'qr' && secondsLeft === 0 && !qrExpired && !isFailed;

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
      {!needsNewCode && <CircularProgress size={14} thickness={5} />}
      <Typography variant="body2">
        {status === 'LOGGED_OUT' ? t.loggedOut : isFailed ? t.failed : t.waiting}
      </Typography>
    </Box>
  );

  const regenerateButton = (
    <Button
      variant="contained"
      startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
      onClick={() => void conn.regenerate()}
      disabled={busy}
    >
      {t.regenerate}
    </Button>
  );

  return (
    <Box sx={{ display: 'grid', gap: 2.5 }}>
      <Typography variant="h6" component="h2" fontWeight={700}>{t.title}</Typography>

      {error && <Alert severity="error">{error}</Alert>}

      <Box
        sx={{
          display: 'grid', gap: 3, alignItems: 'center',
          gridTemplateColumns: { xs: '1fr', sm: '1fr auto' },
        }}
      >
        <NumberedSteps items={mode === 'qr' ? t.qrSteps : t.pairingSteps} />

        {/* Área do código */}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, minWidth: 236 }}>
          {mode === 'qr' ? (
            <>
              <Box
                sx={{
                  width: 236, height: 236, p: 1.5, borderRadius: 3,
                  border: '2px solid', borderColor: alpha(theme.palette.primary.main, 0.4),
                  // QR precisa de fundo claro para a câmera ler, em qualquer tema.
                  bgcolor: 'common.white',
                  display: 'grid', placeItems: 'center', position: 'relative',
                }}
              >
                {qrCode && !needsNewCode ? (
                  <QRCodeSVG
                    value={qrCode}
                    size={206}
                    level="M"
                    fgColor={theme.palette.common.black}
                    bgColor={theme.palette.common.white}
                    role="img"
                    aria-label={t.qrAlt}
                  />
                ) : needsNewCode ? (
                  <Typography variant="body2" sx={{ color: 'grey.700', textAlign: 'center', px: 2 }}>
                    {t.expired}
                  </Typography>
                ) : (
                  <Box sx={{ display: 'grid', placeItems: 'center', gap: 1 }}>
                    <CircularProgress size={36} />
                    <Typography variant="caption" sx={{ color: 'grey.700' }}>{t.preparing}</Typography>
                  </Box>
                )}
              </Box>

              {qrCode && !needsNewCode && secondsLeft !== null && (
                <Box sx={{ width: 236 }}>
                  <LinearProgress
                    variant={refreshingQr ? 'indeterminate' : 'determinate'}
                    value={(secondsLeft / qrTtlSeconds) * 100}
                    color={secondsLeft <= 5 ? 'warning' : 'primary'}
                    sx={{ height: 6, borderRadius: 3 }}
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
                width: '100%', minHeight: 140, p: 2.5, borderRadius: 3, textAlign: 'center',
                border: '1px dashed', borderColor: 'divider', bgcolor: 'action.hover',
                display: 'grid', placeItems: 'center', gap: 1,
              }}
            >
              <Typography variant="caption" color="text.secondary">{t.pairingTitle}</Typography>
              {pairingCode && !isFailed ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography
                    component="span"
                    sx={{ fontFamily: 'monospace', fontSize: { xs: 28, sm: 34 }, fontWeight: 700, letterSpacing: 3 }}
                  >
                    {formatPairingCode(pairingCode)}
                  </Typography>
                  <Tooltip title={copied ? t.copied : t.copy}>
                    <IconButton onClick={() => void copy()} aria-label={t.copy} color={copied ? 'success' : 'default'}>
                      {copied ? <CheckIcon /> : <ContentCopyIcon />}
                    </IconButton>
                  </Tooltip>
                </Box>
              ) : !isFailed ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={18} />
                  <Typography variant="body2" color="text.secondary">{t.pairingLoading}</Typography>
                </Box>
              ) : null}
            </Box>
          )}
        </Box>
      </Box>

      {statusLine}

      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.25 }}>
        {needsNewCode && regenerateButton}
        <Link
          component="button"
          type="button"
          variant="body2"
          onClick={() => void (mode === 'qr' ? conn.switchToPairing() : conn.switchToQr())}
          disabled={busy}
          sx={{ fontWeight: 600 }}
        >
          {mode === 'qr' ? t.usePairing : t.useQr}
        </Link>
      </Box>
    </Box>
  );
}
