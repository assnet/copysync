import { useCallback } from 'react';
import { Alert, AlertTitle, Box, Button, CircularProgress, Stack, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import { CircleCheck, Download, ExternalLink, MonitorX, Puzzle, RefreshCw } from 'lucide-react';
import { AppIcon } from '@/components/AppIcon';
import { extensionApi } from '../services/extensionApi';
import { hasConfiguredExtensionIds, isExtensionChannelBound } from '../channel/client';
import { isExtensionCapableBrowser, openExtensionStore, type ExtensionInstallSource } from '../config';
import { useExtensionInstallWatch } from '../hooks/useExtensionInstallWatch';
import { extensionStrings } from '../strings';

const t = extensionStrings.install;

export interface ExtensionInstallPanelProps {
  /** Tela de origem do clique (métrica `store-click`). */
  source: ExtensionInstallSource;
  /** Chamado uma vez quando a extensão responde ao handshake. */
  onDetected: () => void;
  /** Ícone, título e texto de apoio. Desligue quando quem hospeda já tem título próprio. */
  showIntro?: boolean;
}

/**
 * Instalar pela Chrome Web Store e esperar a extensão aparecer: abre a loja em nova aba,
 * registra o clique (sem bloquear) e checa sozinho até detectar — aí chama `onDetected`.
 * A espera vive em `useExtensionInstallWatch`.
 */
export function ExtensionInstallPanel({ source, onDetected, showIntro = true }: ExtensionInstallPanelProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const watch = useExtensionInstallWatch({ onDetected });
  const { start, startBeforeReload } = watch;
  const compatible = isExtensionCapableBrowser();
  // Instalou com a aba aberta: o Chrome só libera o canal à página depois de recarregar.
  const needsReload = compatible && hasConfiguredExtensionIds() && !isExtensionChannelBound();

  const handleInstall = useCallback(() => {
    openExtensionStore();
    extensionApi.recordStoreClick(source).catch(() => undefined);
    start();
  }, [source, start]);

  const handleRecheck = useCallback(() => {
    if (needsReload) {
      startBeforeReload();
      window.location.reload();
      return;
    }
    start();
  }, [needsReload, start, startBeforeReload]);

  if (!compatible) {
    return (
      <Alert severity="warning" variant="outlined" icon={<AppIcon icon={MonitorX} size="md" />}>
        <AlertTitle sx={{ fontWeight: 700 }}>{t.incompatibleTitle}</AlertTitle>
        {t.incompatibleHint}
      </Alert>
    );
  }

  const recheckButton = (variant: 'outlined' | 'text') => (
    <Tooltip title={needsReload ? t.recheckReloadTooltip : t.recheckTooltip} describeChild>
      <Button variant={variant} onClick={handleRecheck} startIcon={<AppIcon icon={RefreshCw} size="sm" />}>
        {t.recheckAction}
      </Button>
    </Tooltip>
  );

  const storeButton = (primary: boolean) => (
    <Tooltip title={t.storeTooltip} describeChild>
      <Button
        variant={primary ? 'contained' : 'text'}
        disableElevation
        onClick={handleInstall}
        startIcon={primary ? <AppIcon icon={Download} size="sm" /> : undefined}
        endIcon={<AppIcon icon={ExternalLink} size="sm" />}
      >
        {primary ? t.storeAction : t.storeAgain}
      </Button>
    </Tooltip>
  );

  return (
    <Box
      sx={{
        p: { xs: 2, sm: 2.5 },
        borderRadius: 2,
        border: `1px solid ${alpha(theme.palette.primary.main, isDark ? 0.3 : 0.2)}`,
        bgcolor: alpha(theme.palette.primary.main, isDark ? 0.08 : 0.04),
        textAlign: 'left',
      }}
    >
      {showIntro && (
        <Box sx={{ display: 'flex', gap: 1.75, alignItems: 'flex-start', mb: 2 }}>
          <Box
            aria-hidden
            sx={{
              width: 40, height: 40, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0,
              color: 'primary.main', bgcolor: alpha(theme.palette.primary.main, isDark ? 0.2 : 0.12),
            }}
          >
            <AppIcon icon={Puzzle} size="md" />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography component="h3" sx={{ fontWeight: 700, fontSize: '1rem', lineHeight: 1.35 }}>{t.title}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{t.hint}</Typography>
          </Box>
        </Box>
      )}

      {watch.phase === 'idle' && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
          {storeButton(true)}
          {recheckButton('text')}
        </Stack>
      )}

      {watch.phase === 'waiting' && (
        <Box role="status" aria-live="polite">
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', mb: 1.5 }}>
            <CircularProgress size={18} thickness={5} sx={{ mt: 0.25, flexShrink: 0 }} aria-hidden />
            <Box>
              <Typography sx={{ fontWeight: 600, fontSize: '0.9375rem' }}>{t.waitingTitle}</Typography>
              <Typography variant="body2" color="text.secondary">{t.waitingHint}</Typography>
            </Box>
          </Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
            {recheckButton('outlined')}
            {storeButton(false)}
          </Stack>
        </Box>
      )}

      {watch.phase === 'timed_out' && (
        <Box>
          <Alert severity="info" variant="outlined" sx={{ mb: 1.5 }} role="status">
            <AlertTitle sx={{ fontWeight: 700 }}>{t.timedOutTitle}</AlertTitle>
            {t.timedOutHint}
          </Alert>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
            {recheckButton('outlined')}
            {storeButton(false)}
          </Stack>
        </Box>
      )}

      {watch.phase === 'detected' && (
        <Box role="status" sx={{ display: 'flex', gap: 1, alignItems: 'center', color: 'success.main', fontWeight: 600 }}>
          <AppIcon icon={CircleCheck} size="md" />
          <span>{t.detectedTitle}</span>
        </Box>
      )}

      {watch.phase !== 'detected' && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 2, lineHeight: 1.5 }}>
          {t.footerPrefix}{' '}
          <Box
            component="code"
            sx={{ px: 0.5, py: 0.125, borderRadius: 0.75, bgcolor: 'action.hover', fontFamily: 'monospace', fontSize: '0.95em' }}
          >
            {t.footerExtensionsUrl}
          </Box>{' '}
          {t.footerSuffix}
        </Typography>
      )}
    </Box>
  );
}
