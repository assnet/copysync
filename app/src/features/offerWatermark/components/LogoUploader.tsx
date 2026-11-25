import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Box, Button, FormHelperText, LinearProgress, Stack, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { ImagePlus, Trash2, Upload } from 'lucide-react';
import { AppIcon, ConfirmDialog } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { uploadInParts, UploadAbortedError } from '@/features/chat/media/chunkedUpload';
import { mediaService } from '@/services/media.service';
import { logoErrorMessage } from '../errors';
import { WATERMARK_LOGO_TYPES, checkWatermarkLogo } from '../rules';
import { logoProblemMessage, offerWatermarkStrings } from '../strings';

const t = offerWatermarkStrings.logo;
const ACCEPT = WATERMARK_LOGO_TYPES.join(',');

interface Props {
  /** Logo atual já normalizado pela API (nunca guardado no navegador); null = sem logo. */
  imageUrl: string | null;
  /** Aplica o upload concluído (`PUT /offer-watermark/image`); lança em erro de mídia. */
  onUploaded: (uploadId: string) => Promise<void>;
  /** Confirmado no diálogo: `DELETE /offer-watermark/image`; lança em erro. */
  onRemove: () => Promise<void>;
  disabled?: boolean;
}

/**
 * Logo da marca: envio por `chunkedUpload` (checagem leve de tipo e tamanho antes; conteúdo,
 * transparência e dimensão na API), miniatura sobre xadrez (mostra a transparência) e remoção com confirmação.
 */
export function LogoUploader({ imageUrl, onUploaded, onRemove, disabled }: Props) {
  const blur = useBlur('offerWatermark.logo');
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const busy = progress !== null;

  useEffect(() => () => abort.current?.abort(), []);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const problem = checkWatermarkLogo(file);
    if (problem) {
      setError(logoProblemMessage(problem));
      return;
    }
    setError(null);
    const controller = new AbortController();
    abort.current = controller;
    setProgress(0);
    try {
      const { uploadId } = await uploadInParts({
        file, fileName: file.name, purpose: 'media', declaredMimeType: file.type,
        client: mediaService, signal: controller.signal, onProgress: setProgress,
      });
      await onUploaded(uploadId);
    } catch (err) {
      if (!(err instanceof UploadAbortedError) && !controller.signal.aborted) setError(logoErrorMessage(err));
    } finally {
      if (abort.current === controller) abort.current = null;
      setProgress(null);
    }
  };

  const remove = async () => {
    setError(null);
    try {
      await onRemove();
    } catch {
      setError(t.errors.removeFailed);
    }
  };

  return (
    <Box>
      <Typography variant="subtitle2" component="p" sx={{ fontWeight: 600, mb: 0.75 }}>{t.label}</Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', sm: 'center' }}>
        <Box
          sx={(theme) => {
            const sq = alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.14 : 0.08);
            return {
              width: 112, height: 112, flexShrink: 0, borderRadius: 2, overflow: 'hidden',
              border: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 1,
              // Xadrez: deixa a transparência do logo visível nos dois temas
              backgroundColor: 'background.paper',
              backgroundImage: `linear-gradient(45deg, ${sq} 25%, transparent 25%, transparent 75%, ${sq} 75%), linear-gradient(45deg, ${sq} 25%, transparent 25%, transparent 75%, ${sq} 75%)`,
              backgroundSize: '16px 16px', backgroundPosition: '0 0, 8px 8px',
            };
          }}
        >
          {imageUrl ? (
            <Blurred when={blur} radius={10} sx={{ width: '100%', height: '100%' }}>
              <Box component="img" src={imageUrl} alt={t.alt} sx={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
            </Blurred>
          ) : (
            <Box sx={{ color: 'text.secondary', display: 'inline-flex' }}><AppIcon icon={ImagePlus} size="lg" /></Box>
          )}
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            variant={imageUrl ? 'outlined' : 'contained'}
            startIcon={<AppIcon icon={Upload} size="sm" />}
            onClick={() => input.current?.click()}
            disabled={disabled || busy}
            sx={{ minHeight: 44 }}
          >
            {imageUrl ? t.replace : t.choose}
          </Button>
          {imageUrl && (
            <Tooltip title={t.remove} arrow describeChild>
              <span>
                <Button
                  color="error"
                  variant="text"
                  startIcon={<AppIcon icon={Trash2} size="sm" />}
                  onClick={() => setConfirmRemove(true)}
                  disabled={disabled || busy}
                  sx={{ minHeight: 44 }}
                >
                  {t.remove}
                </Button>
              </span>
            </Tooltip>
          )}
        </Stack>
      </Stack>
      <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => void pick(e)} data-testid="watermark-logo-input" />

      {busy && (
        <Box sx={{ mt: 1, maxWidth: 360 }} aria-live="polite">
          <LinearProgress variant="determinate" value={progress ?? 0} aria-label={t.uploading} />
          <FormHelperText>{t.uploading}</FormHelperText>
        </Box>
      )}
      <FormHelperText sx={{ mt: 0.75 }}>{t.rule}</FormHelperText>
      {error && <FormHelperText error role="alert">{error}</FormHelperText>}

      <ConfirmDialog
        open={confirmRemove}
        title={t.confirmRemove.title}
        description={t.confirmRemove.message}
        confirmLabel={t.confirmRemove.confirm}
        cancelLabel={t.confirmRemove.cancel}
        confirmColor="error"
        onClose={() => setConfirmRemove(false)}
        onConfirm={() => {
          setConfirmRemove(false);
          void remove();
        }}
      />
    </Box>
  );
}
