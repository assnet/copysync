import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Box, ButtonBase, FormHelperText, IconButton, LinearProgress, Stack, Tooltip, Typography, alpha } from '@mui/material';
import { ImagePlus, Trash2 } from 'lucide-react';
import { AppIcon, ConfirmDialog } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { uploadInParts, UploadAbortedError } from '@/features/chat/media/chunkedUpload';
import { mediaService } from '@/services/media.service';
import { checkStorefrontImage, STOREFRONT_IMAGE_TYPES } from '../imageRules';
import { errorMessage } from '../storefrontForm';
import { storefrontStrings } from '../strings';
import type { StorefrontImageKind } from '../types';

const ACCEPT = STOREFRONT_IMAGE_TYPES.join(',');

export interface ImagePickerProps {
  kind: StorefrontImageKind;
  /** Imagem atual já processada pela API; null = sem imagem. */
  imageUrl: string | null;
  /** Upload concluído: a página aplica com `storefrontService.setImage(kind, uploadId)` (recorte no servidor). */
  onUploaded: (uploadId: string) => void | Promise<void>;
  /** Confirmado no `ConfirmDialog`: a página chama `removeImage(kind)`. */
  onRemove: () => void | Promise<void>;
  /** Erro vindo da página (ex.: `MEDIA_PROCESSING_FAILED` ao aplicar). */
  error?: string | null;
  disabled?: boolean;
}

/** Foto (círculo) ou capa (3:1): clique para trocar, regra visível, prévia e remover. */
export function ImagePicker({ kind, imageUrl, onUploaded, onRemove, error, disabled }: ImagePickerProps) {
  const t = kind === 'avatar' ? storefrontStrings.fields.photo : storefrontStrings.fields.cover;
  const blur = useBlur(kind === 'avatar' ? 'storefront.photo' : 'storefront.cover');
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const busy = progress !== null;

  useEffect(() => () => abort.current?.abort(), []);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const problem = checkStorefrontImage(kind, file);
    if (problem) {
      setLocalError(errorMessage(problem));
      return;
    }
    setLocalError(null);
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
      if (!(err instanceof UploadAbortedError) && !controller.signal.aborted) setLocalError(errorMessage(err));
    } finally {
      if (abort.current === controller) abort.current = null;
      setProgress(null);
    }
  };

  const shownError = localError ?? error ?? null;
  const avatar = kind === 'avatar';

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: 0.4 }}>{t.label}</Typography>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 0.75 }}>
        <ButtonBase
          onClick={() => input.current?.click()}
          disabled={disabled || busy}
          aria-label={imageUrl ? t.replace : t.choose}
          sx={(theme) => ({
            position: 'relative', overflow: 'hidden', flexShrink: 0,
            width: avatar ? 96 : '100%', maxWidth: avatar ? 96 : 360, aspectRatio: avatar ? '1 / 1' : '3 / 1',
            borderRadius: avatar ? '50%' : 2,
            border: `1px dashed ${theme.palette.divider}`,
            bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.1 : 0.05),
            '&:hover .image-picker-hint, &.Mui-focusVisible .image-picker-hint': { opacity: 1 },
            '&.Mui-focusVisible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
          })}
        >
          {imageUrl ? (
            <Blurred when={blur} radius={12} sx={{ width: '100%', height: '100%' }}>
              <Box component="img" src={imageUrl} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </Blurred>
          ) : (
            <Stack spacing={0.5} alignItems="center" sx={{ color: 'text.secondary', p: 1 }}>
              <AppIcon icon={ImagePlus} size="md" />
              {!avatar && <Typography variant="caption" sx={{ fontWeight: 600 }}>{t.choose}</Typography>}
            </Stack>
          )}
          {imageUrl && <Box
            className="image-picker-hint"
            sx={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 1,
              bgcolor: 'rgba(0,0,0,0.55)', color: '#fff', opacity: 0, transition: 'opacity 150ms',
              '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
            }}
          >
            <Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'center' }}>{t.clickToChange}</Typography>
          </Box>}
        </ButtonBase>
        {imageUrl && !busy && (
          <Tooltip title={t.remove} arrow>
            <span>
              <IconButton aria-label={t.remove} onClick={() => setConfirmRemove(true)} disabled={disabled} color="error">
                <AppIcon icon={Trash2} size="sm" />
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Stack>
      <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => void pick(e)} data-testid={`image-input-${kind}`} />

      {busy && (
        <Box sx={{ mt: 1, maxWidth: 360 }} aria-live="polite">
          <LinearProgress variant="determinate" value={progress ?? 0} aria-label={t.uploading} />
          <FormHelperText>{t.uploading}</FormHelperText>
        </Box>
      )}
      <FormHelperText sx={{ mt: 0.75 }}>{t.rule}</FormHelperText>
      {shownError && <FormHelperText error role="alert">{shownError}</FormHelperText>}

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
          void onRemove();
        }}
      />
    </Box>
  );
}
