import { useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import { useBlur } from '@/features/privacy';
import AddPhotoAlternateOutlinedIcon from '@mui/icons-material/AddPhotoAlternateOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import type { OfferItem } from '@/types/api.types';
import { offerStrings } from '../strings';
import { OFFER_TEXT_MAX, type OfferDraft } from '../hooks/useOfferDraft';
import { centsToInput, parseCentsInput } from '../utils/offerPrice';

const t = offerStrings.editor;

interface Props {
  offer: OfferItem;
  draft: OfferDraft;
  onField: <K extends keyof OfferDraft>(key: K, value: OfferDraft[K]) => void;
  /** Loja sem dados automáticos: mostra título, preço e foto. */
  needsManualData: boolean;
  dirty: boolean;
  saving: boolean;
  textTooLong: boolean;
  /** 0–100 durante o upload da foto; `null` parado. */
  imageProgress: number | null;
  onSave: () => void;
  onCancel: () => void;
  onReplaceImage: (file: File) => void;
}

/** Edição em linha sob a prévia: texto sempre; título/preço/foto só quando a loja não mandou os dados. */
export function OfferEditor({
  offer, draft, onField, needsManualData, dirty, saving, textTooLong, imageProgress, onSave, onCancel, onReplaceImage,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const uploading = imageProgress != null;
  const showImage = needsManualData || !offer.imageUrl;

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setImageError(t.imageOnly);
      return;
    }
    setImageError(null);
    onReplaceImage(file);
  };

  const blurText = useBlur('offers.productText');
  const blurSx = blurText ? { '& .MuiInputBase-input': { filter: 'blur(5px)', userSelect: 'none' } } : undefined;

  return (
    <Stack spacing={2} component="section" aria-label={t.title}>
      {/* `blurSx` nos campos de título e texto (privacidade) */}
      {needsManualData && <Alert severity="info">{t.manualData}</Alert>}

      {needsManualData && (
        <>
          <TextField
            sx={blurSx}
            label={t.titleLabel}
            value={draft.title}
            onChange={(e) => onField('title', e.target.value)}
            disabled={saving}
            fullWidth
            size="small"
            slotProps={{ htmlInput: { maxLength: 300 } }}
          />
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
            <TextField
              size="small"
              label={t.priceLabel}
              value={centsToInput(draft.priceCents)}
              onChange={(e) => onField('priceCents', parseCentsInput(e.target.value))}
              disabled={saving}
              placeholder="R$ 0,00"
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            />
            <TextField
              size="small"
              label={t.originalPriceLabel}
              value={centsToInput(draft.originalPriceCents)}
              onChange={(e) => onField('originalPriceCents', parseCentsInput(e.target.value))}
              disabled={saving}
              placeholder="R$ 0,00"
              helperText={t.originalPriceHelper}
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            />
          </Box>
        </>
      )}

      {showImage && (
        <Box>
          {!needsManualData && <Alert severity="warning" sx={{ mb: 1.5 }}>{t.imageMissing}</Alert>}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              pickFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <Button
            variant="outlined"
            size="small"
            startIcon={uploading ? <CircularProgress size={16} color="inherit" /> : <AddPhotoAlternateOutlinedIcon />}
            disabled={saving || uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? t.uploadingImage(imageProgress) : offer.imageUrl ? t.replaceImage : t.addImage}
          </Button>
          {imageError && (
            <Typography variant="caption" color="error" component="p" role="alert" sx={{ mt: 0.75 }}>
              {imageError}
            </Typography>
          )}
        </Box>
      )}

      <Box>
        <TextField
          sx={blurSx}
          label={t.textLabel}
          value={draft.text}
          onChange={(e) => onField('text', e.target.value)}
          disabled={saving}
          fullWidth
          multiline
          minRows={6}
          maxRows={16}
          error={textTooLong}
          helperText={textTooLong ? t.textTooLong(OFFER_TEXT_MAX) : undefined}
          autoFocus
        />
        <Typography
          variant="caption"
          color={textTooLong ? 'error' : 'text.secondary'}
          component="p"
          sx={{ textAlign: 'right', mt: 0.5 }}
        >
          {t.charCount(draft.text.length, OFFER_TEXT_MAX)}
        </Typography>
      </Box>

      <Stack direction="row" spacing={1} justifyContent="flex-end">
        <Button color="inherit" onClick={onCancel} disabled={saving}>{t.cancel}</Button>
        <Button
          variant="contained"
          disableElevation
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveOutlinedIcon />}
          disabled={!dirty || saving || textTooLong}
          onClick={onSave}
        >
          {saving ? t.saving : t.save}
        </Button>
      </Stack>
    </Stack>
  );
}
