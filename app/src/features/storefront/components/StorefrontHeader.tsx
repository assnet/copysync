import { Box, Button, IconButton, Stack, Tooltip, Typography, alpha, useMediaQuery, useTheme } from '@mui/material';
import { Check, Copy, ExternalLink, Store } from 'lucide-react';
import { AppIcon } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import { storefrontStrings } from '../strings';

const t = storefrontStrings;

export interface StorefrontHeaderProps {
  /** null = página ainda sem endereço (não criada ou janela inconsistente). */
  publicUrl: string | null;
  /** Clipboard bloqueado: quem chama mostra o aviso. */
  onCopyFailed: () => void;
}

/** Topo da Página de Ofertas: título, subtítulo e o endereço público (copiar / abrir). */
export function StorefrontHeader({ publicUrl, onCopyFailed }: StorefrontHeaderProps) {
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  const compact = useMediaQuery(theme.breakpoints.down('sm'));
  const blurAddress = useBlur('storefront.subdomain');
  const clipboard = useCopyToClipboard(onCopyFailed);
  const copied = clipboard.copied;
  const copy = async () => {
    if (publicUrl) await clipboard.copy(publicUrl);
  };

  const { primary, secondary } = theme.palette;
  return (
    <Box
      component="header"
      sx={{
        mb: 3, px: { xs: 2.5, sm: 4 }, py: { xs: 3, sm: 3.5 }, borderRadius: 3,
        border: '1px solid', borderColor: alpha(primary.main, dark ? 0.35 : 0.2),
        background: `linear-gradient(135deg, ${alpha(primary.main, dark ? 0.32 : 0.14)} 0%, ${alpha(secondary.main, dark ? 0.16 : 0.08)} 60%, ${theme.palette.background.paper} 100%)`,
      }}
    >
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2.5} alignItems={{ md: 'center' }} justifyContent="space-between">
        <Stack direction="row" spacing={2} alignItems="center" sx={{ minWidth: 0, flex: { md: 1 } }}>
          <Box
            aria-hidden
            sx={{
              width: 48, height: 48, borderRadius: 2.5, display: 'grid', placeItems: 'center', flexShrink: 0,
              color: primary.contrastText, backgroundImage: `linear-gradient(135deg, ${primary.main}, ${secondary.main})`,
              boxShadow: `0 8px 20px -8px ${alpha(primary.main, 0.6)}`,
            }}
          >
            <AppIcon icon={Store} size="lg" />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h5" component="h1" sx={{ fontWeight: 800 }}>{t.page.title}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 560 }}>{t.page.subtitle}</Typography>
          </Box>
        </Stack>

        {publicUrl && (
          // Celular: endereço em linha própria (quebra em qualquer ponto) e ações só ícone.
          // Desktop: endereço em fonte menor, quebrando por caractere em vez de cortar o host.
          <Stack
            direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}
            role="group" aria-label={t.address.label}
            sx={{
              minWidth: 0, maxWidth: { xs: '100%', md: '50%' }, flex: { md: '0 1 auto' },
              pl: 1.75, pr: 0.75, py: 0.75, borderRadius: 2.5,
              bgcolor: alpha(theme.palette.background.paper, dark ? 0.6 : 0.85), border: '1px solid', borderColor: 'divider',
            }}
          >
            <Typography
              variant="body2" title={blurAddress ? undefined : publicUrl}
              sx={{ fontFamily: 'monospace', fontSize: '0.8125rem', lineHeight: 1.4, overflowWrap: 'anywhere', minWidth: 0, flex: 1, pt: { xs: 0.5, sm: 0 } }}
            >
              <Blurred when={blurAddress} inline radius={5}>{publicUrl.replace(/^https?:\/\//, '')}</Blurred>
            </Typography>
            <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end" sx={{ flexShrink: 0 }}>
              <Tooltip title={copied ? t.address.copied : t.address.copy} arrow>
                {compact ? (
                  <IconButton size="small" color={copied ? 'success' : 'primary'} onClick={() => void copy()} aria-label={t.address.copy} sx={{ width: 40, height: 40 }}>
                    <AppIcon icon={copied ? Check : Copy} size="sm" />
                  </IconButton>
                ) : (
                  <Button
                    size="small" variant={copied ? 'outlined' : 'contained'} color={copied ? 'success' : 'primary'} disableElevation
                    onClick={() => void copy()} aria-label={t.address.copy}
                    startIcon={<AppIcon icon={copied ? Check : Copy} size="sm" />}
                    sx={{ borderRadius: 999, flexShrink: 0, minHeight: 36, whiteSpace: 'nowrap' }}
                  >
                    <Box component="span" aria-live="polite">{copied ? t.address.copied : t.address.copy}</Box>
                  </Button>
                )}
              </Tooltip>
              <Tooltip title={t.address.openTooltip} arrow>
                {compact ? (
                  <IconButton size="small" component="a" href={publicUrl} target="_blank" rel="noopener noreferrer" aria-label={t.address.open} sx={{ width: 40, height: 40 }}>
                    <AppIcon icon={ExternalLink} size="sm" />
                  </IconButton>
                ) : (
                  <Button
                    size="small" variant="text" component="a" href={publicUrl} target="_blank" rel="noopener noreferrer"
                    startIcon={<AppIcon icon={ExternalLink} size="sm" />} sx={{ borderRadius: 999, flexShrink: 0, minHeight: 36, whiteSpace: 'nowrap' }}
                  >
                    {t.address.open}
                  </Button>
                )}
              </Tooltip>
            </Stack>
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
