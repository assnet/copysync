import { useCallback, useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, Divider, Snackbar, Stack, Tooltip, Typography } from '@mui/material';
import { Check, Copy, Download, Pencil, Plus, Share2, ShieldAlert } from 'lucide-react';
import { AppIcon } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { useCopyToClipboard } from '@/features/storefront/hooks/useCopyToClipboard';
import { canShareImage, dataUrlToFile, downloadImage, shareImage, storyFileName } from '../shareImage';
import { offerStoryStrings } from '../strings';
import type { OfferStoryResult } from '../types';
import { PhoneFrame } from './PhoneFrame';

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

/** Passo 3: arte na moldura, avisos e ações (compartilhar, baixar, copiar link). */
export function ResultStep({ result, onEdit, onNew }: Props) {
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

  return (
    <Box sx={{ display: 'grid', gap: { xs: 3, md: 5 }, gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: '320px minmax(0, 1fr)' }, alignItems: 'start' }}>
      <PhoneFrame>
        <Blurred when={blurArt} radius={14} sx={{ height: '100%' }}>
          <Box component="img" src={result.image} alt={blurArt ? t.imageAltHidden : t.imageAlt(result.headline)} sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </Blurred>
      </PhoneFrame>

      <Stack spacing={2.5} sx={{ minWidth: 0 }}>
        <Box>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 800 }}>{t.title}</Typography>
          <Typography variant="body2" color="text.secondary">{t.subtitle}</Typography>
        </Box>

        {result.warnings.map((w) => (
          <Alert key={w} severity={w === 'AI_FALLBACK' ? 'info' : 'warning'}>{t.warnings[w]}</Alert>
        ))}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          {shareable && (
            <Button variant="contained" disableElevation size="large" startIcon={<AppIcon icon={Share2} size="sm" />} onClick={() => void share()}>
              {t.share}
            </Button>
          )}
          <Button
            variant={shareable ? 'outlined' : 'contained'} disableElevation size="large"
            startIcon={<AppIcon icon={Download} size="sm" />} disabled={!file} onClick={() => file && downloadImage(file)}
          >
            {t.download}
          </Button>
        </Stack>

        <Box sx={{ p: 2, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t.linkLabel}</Typography>
            {!result.attributionVerified && (
              <Tooltip title={t.unverifiedTooltip} arrow describeChild>
                <Chip size="small" color="warning" variant="outlined" icon={<AppIcon icon={ShieldAlert} size="sm" />} label={t.unverified} tabIndex={0} />
              </Tooltip>
            )}
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8125rem', overflowWrap: 'anywhere', flex: 1, minWidth: 0 }}>
              <Blurred when={blurLink} inline radius={5}>{result.affiliateUrl}</Blurred>
            </Typography>
            <Tooltip title={clipboard.copied ? t.copied : t.copyLinkTooltip} arrow describeChild>
              <Button
                variant="outlined" color={clipboard.copied ? 'success' : 'primary'} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                startIcon={<AppIcon icon={clipboard.copied ? Check : Copy} size="sm" />}
                onClick={() => void clipboard.copy(result.affiliateUrl)}
              >
                <Box component="span" aria-live="polite">{clipboard.copied ? t.copied : t.copyLink}</Box>
              </Button>
            </Tooltip>
          </Stack>
        </Box>

        <Divider />

        <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'space-between' }}>
          <Button color="inherit" startIcon={<AppIcon icon={Pencil} size="sm" />} onClick={onEdit}>{t.edit}</Button>
          <Button variant="text" startIcon={<AppIcon icon={Plus} size="sm" />} onClick={onNew}>{t.newArt}</Button>
        </Stack>
      </Stack>

      <Snackbar open={toast !== null} autoHideDuration={5000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="error" variant="filled" onClose={() => setToast(null)}>{toast}</Alert>
      </Snackbar>
    </Box>
  );
}
