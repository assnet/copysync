import { useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import AddPhotoAlternateOutlinedIcon from '@mui/icons-material/AddPhotoAlternateOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import { SectionCard } from '@/components';
import type { OfferItem } from '@/types/api.types';
import { offerStrings } from '../strings';
import { OFFER_TEXT_MAX, type OfferDraft } from '../hooks/useOfferDraft';
import { centsToInput, parseCentsInput } from '../utils/offerPrice';

const t = offerStrings.editor;

interface Props {
  offer: OfferItem;
  draft: OfferDraft;
  onField: <K extends keyof OfferDraft>(key: K, value: OfferDraft[K]) => void;
  needsManualData: boolean;
  dirty: boolean;
  saving: boolean;
  textTooLong: boolean;
  missingLink: boolean;
  /** 0–100 durante o upload da foto; `null` parado. */
  imageProgress: number | null;
  onSave: () => void;
  onReplaceImage: (file: File) => void;
}

export function OfferEditor({
  offer, draft, onField, needsManualData, dirty, saving, textTooLong, missingLink, imageProgress, onSave, onReplaceImage,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  // Espelha `EDITABLE_OFFER_STATUSES` da API: só rascunho edita e envia.
  const locked = offer.status !== 'DRAFT';
  const uploading = imageProgress != null;
  const busy = locked || saving;

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setImageError(t.imageOnly);
      return;
    }
    setImageError(null);
    onReplaceImage(file);
  };

  return (
    <SectionCard title={t.title}>
      <Stack spacing={2.5}>
        {locked && <Alert severity="info">{t.locked}</Alert>}
        {!locked && needsManualData && <Alert severity="info">{t.manualData}</Alert>}
        {!locked && !needsManualData && offer.provider === 'SHOPEE' && !offer.imageUrl && (
          <Alert severity="warning">{t.imageMissing}</Alert>
        )}
        {!offer.attributionVerified && <Alert severity="warning">{t.attributionUnverified}</Alert>}

        <TextField
          label={t.titleLabel}
          value={draft.title}
          onChange={(e) => onField('title', e.target.value)}
          disabled={busy}
          fullWidth
          slotProps={{ htmlInput: { maxLength: 300 } }}
        />

        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
          <TextField
            label={t.priceLabel}
            value={centsToInput(draft.priceCents)}
            onChange={(e) => onField('priceCents', parseCentsInput(e.target.value))}
            disabled={busy}
            placeholder="R$ 0,00"
            slotProps={{ htmlInput: { inputMode: 'numeric' } }}
          />
          <TextField
            label={t.originalPriceLabel}
            value={centsToInput(draft.originalPriceCents)}
            onChange={(e) => onField('originalPriceCents', parseCentsInput(e.target.value))}
            disabled={busy}
            placeholder="R$ 0,00"
            helperText={t.originalPriceHelper}
            slotProps={{ htmlInput: { inputMode: 'numeric' } }}
          />
        </Box>

        <Box>
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
            startIcon={uploading ? <CircularProgress size={16} color="inherit" /> : <AddPhotoAlternateOutlinedIcon />}
            disabled={busy || uploading}
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

        <Box>
          <TextField
            label={t.textLabel}
            value={draft.text}
            onChange={(e) => onField('text', e.target.value)}
            disabled={busy}
            fullWidth
            multiline
            minRows={6}
            maxRows={16}
            error={textTooLong}
            helperText={textTooLong ? t.textTooLong(OFFER_TEXT_MAX) : offer.textEdited ? t.textManual : t.textAuto}
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

        {!locked && missingLink && <Alert severity="warning">{t.missingLink}</Alert>}

        {!locked && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="outlined"
              startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveOutlinedIcon />}
              disabled={!dirty || saving || textTooLong}
              onClick={onSave}
            >
              {saving ? t.saving : t.save}
            </Button>
          </Box>
        )}
      </Stack>
    </SectionCard>
  );
}
