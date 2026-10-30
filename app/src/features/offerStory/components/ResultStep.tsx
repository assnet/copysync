import { useCallback, useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, Snackbar, Stack, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import { Check, CircleCheckBig, Copy, Download, Link2, Pencil, Plus, Share2, ShieldAlert } from 'lucide-react';
import { AppIcon } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { useCopyToClipboard } from '@/features/storefront/hooks/useCopyToClipboard';
import { canShareImage, dataUrlToFile, downloadImage, shareImage, storyFileName } from '../shareImage';
import { offerStoryStrings } from '../strings';
import { REDUCED_MOTION, popIn, riseIn, storyGradient, storyWash } from '../storyStyle';
import type { OfferStoryResult } from '../types';
import { DeviceFrame } from './DeviceFrame';

const t = offerStoryStrings.result;

interface Props {
  result: OfferStoryResult;
  onEdit: () => void;
  onNew: () => void;
}

function toFile(result: OfferStoryResult): File | null {
  try {
    return dataUrlToFile(result.image, storyFileName());
  } catch {
    return null;
  }
}

/** Passo 3: celebração, arte no celular, ações (compartilhar, baixar, copiar link) e dicas. */
export function ResultStep({ result, onEdit, onNew }: Props) {
  const theme = useTheme();
  const blurArt = useBlur('offerStory.art');
  const blurLink = useBlur('offerStory.link');
  const [toast, setToast] = useState<string | null>(null);
  const onCopyFailed = useCallback(() => setToast(t.copyFailed), []);
  const clipboard = useCopyToClipboard(onCopyFailed);

  const file = useMemo(() => toFile(result), [result]);
  const shareable = useMemo(() => (file ? canShareImage(file) : false), [file]);

  const share = async () => {
    if (!file) return;
    if ((await shareImage(file)) === 'failed') setToast(t.shareFailed);
  };

  const gradientButton = {
    py: 1.25, px: 3, borderRadius: 999, fontWeight: 700, color: 'common.white',
    backgroundImage: storyGradient(theme, 45),
    boxShadow: `0 12px 28px -12px ${alpha(theme.palette.error.main, 0.8)}`,
    '&:hover': { backgroundImage: storyGradient(theme, 45), filter: 'brightness(1.08)' },
  } as const;

  return (
    <Box sx={{ display: 'grid', rowGap: { xs: 2.5, md: 3 }, columnGap: 6, gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: '340px minmax(0, 1fr)' }, gridTemplateRows: { md: 'auto 1fr' }, alignItems: 'start' }}>
      {/* Título primeiro no xs (ordem visual); no md+ fica na coluna da direita. */}
      <Box sx={{ gridColumn: { md: 2 }, gridRow: { md: 1 }, display: 'flex', alignItems: 'center', gap: 1.5, animation: `${riseIn} 320ms ease-out`, [REDUCED_MOTION]: { animation: 'none' } }}>
        <Box
          aria-hidden
          sx={{
            width: { xs: 40, sm: 48 }, height: { xs: 40, sm: 48 }, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0,
            color: 'common.white', backgroundImage: storyGradient(theme, 135),
            animation: `${popIn} 420ms ease-out`, [REDUCED_MOTION]: { animation: 'none' },
          }}
        >
          <AppIcon icon={CircleCheckBig} size="md" />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h5" component="h2" sx={{ fontWeight: 800, letterSpacing: '-0.02em', fontSize: { xs: '1.2rem', sm: '1.5rem' } }}>{t.title}</Typography>
          <Typography variant="body2" color="text.secondary">{t.subtitle}</Typography>
        </Box>
      </Box>

      <Box sx={{ gridColumn: { md: 1 }, gridRow: { md: '1 / span 2' }, position: 'relative', py: { xs: 0, md: 2 }, px: { xs: 3, md: 2 } }}>
        <Box aria-hidden sx={{ position: 'absolute', inset: 0, borderRadius: '28px', backgroundImage: storyWash(theme), filter: 'blur(8px)' }} />
        <Box sx={{ position: 'relative' }}>
          {/* xs: altura ~38dvh para título e ações caberem sem rolar em 390×844. */}
          <DeviceFrame maxWidth={300} fitViewportHeight={38}>
            <Blurred when={blurArt} radius={14} sx={{ height: '100%' }}>
              <Box component="img" src={result.image} alt={blurArt ? t.imageAltHidden : t.imageAlt(result.headline)} sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </Blurred>
          </DeviceFrame>
        </Box>
      </Box>

      <Stack spacing={2.5} sx={{ gridColumn: { md: 2 }, gridRow: { md: 2 }, minWidth: 0 }}>
        {/* xs: as duas ações na mesma linha (baixar vira ícone quando há compartilhar) para caber acima da dobra. */}
        <Stack direction="row" spacing={1.5}>
          {shareable && (
            <Button variant="contained" disableElevation size="large" startIcon={<AppIcon icon={Share2} size="sm" />} onClick={() => void share()} sx={{ ...gradientButton, flex: { xs: 1, sm: '0 0 auto' } }}>
              {t.share}
            </Button>
          )}
          <Tooltip title={shareable ? t.download : ''} arrow>
            <Button
              variant={shareable ? 'outlined' : 'contained'} disableElevation size="large"
              aria-label={t.download}
              startIcon={<AppIcon icon={Download} size="sm" />} disabled={!file} onClick={() => file && downloadImage(file)}
              sx={shareable
                ? { py: 1.25, px: { xs: 2, sm: 3 }, minWidth: 0, borderRadius: 999, fontWeight: 700, '& .MuiButton-startIcon': { mr: { xs: 0, sm: 1 }, ml: { xs: 0, sm: -0.5 } } }
                : { ...gradientButton, flex: { xs: 1, sm: '0 0 auto' } }}
            >
              <Box component="span" sx={{ display: { xs: shareable ? 'none' : 'inline', sm: 'inline' } }}>{t.download}</Box>
            </Button>
          </Tooltip>
        </Stack>

        {result.warnings.map((w) => (
          <Alert key={w} severity={w === 'AI_FALLBACK' ? 'info' : 'warning'} sx={{ borderRadius: '16px' }}>{t.warnings[w]}</Alert>
        ))}

        <Box sx={{ p: 2, borderRadius: '16px', border: '1px solid', borderColor: 'divider', bgcolor: alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.03 : 0.015) }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.25, flexWrap: 'wrap', rowGap: 1 }}>
            <AppIcon icon={Link2} size="sm" aria-hidden />
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t.linkLabel}</Typography>
            {!result.attributionVerified && (
              <Tooltip title={t.unverifiedTooltip} arrow describeChild>
                <Chip size="small" color="warning" variant="outlined" icon={<AppIcon icon={ShieldAlert} size="sm" />} label={t.unverified} tabIndex={0}
                  sx={theme.palette.mode === 'light' ? { color: 'warning.dark', borderColor: 'warning.dark', '& svg': { color: 'warning.dark' } } : undefined} />
              </Tooltip>
            )}
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
            <Typography
              variant="body2"
              sx={{
                fontFamily: 'monospace', fontSize: '0.8125rem', overflowWrap: 'anywhere', flex: 1, minWidth: 0,
                px: 1.5, py: 1, borderRadius: '10px', bgcolor: alpha(theme.palette.text.primary, 0.05),
              }}
            >
              <Blurred when={blurLink} inline radius={5}>{result.affiliateUrl}</Blurred>
            </Typography>
            <Tooltip title={clipboard.copied ? t.copied : t.copyLinkTooltip} arrow describeChild>
              <Button
                variant={clipboard.copied ? 'contained' : 'outlined'} disableElevation color={clipboard.copied ? 'success' : 'primary'}
                sx={{ flexShrink: 0, whiteSpace: 'nowrap', borderRadius: 999, px: 2 }}
                startIcon={<AppIcon icon={clipboard.copied ? Check : Copy} size="sm" />}
                onClick={() => void clipboard.copy(result.affiliateUrl)}
              >
                <Box component="span" aria-live="polite">{clipboard.copied ? t.copied : t.copyLink}</Box>
              </Button>
            </Tooltip>
          </Stack>
        </Box>

        <Box>
          <Typography variant="subtitle2" component="h3" sx={{ fontWeight: 700, mb: 1 }}>{t.tipsTitle}</Typography>
          <Stack component="ol" spacing={1} sx={{ listStyle: 'none', p: 0, m: 0 }}>
            {t.tips.map((tip, i) => (
              <Box component="li" key={tip} sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                <Box
                  aria-hidden
                  sx={{
                    width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0,
                    fontSize: '0.75rem', fontWeight: 700, color: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.12),
                  }}
                >
                  {i + 1}
                </Box>
                <Typography variant="body2" color="text.secondary">{tip}</Typography>
              </Box>
            ))}
          </Stack>
        </Box>

        <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'space-between', pt: 2, borderTop: 1, borderColor: 'divider' }}>
          <Button color="inherit" startIcon={<AppIcon icon={Pencil} size="sm" />} onClick={onEdit} sx={{ borderRadius: 999 }}>{t.edit}</Button>
          <Button variant="text" startIcon={<AppIcon icon={Plus} size="sm" />} onClick={onNew} sx={{ borderRadius: 999 }}>{t.newArt}</Button>
        </Stack>
      </Stack>

      <Snackbar open={toast !== null} autoHideDuration={5000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="error" variant="filled" onClose={() => setToast(null)}>{toast}</Alert>
      </Snackbar>
    </Box>
  );
}
