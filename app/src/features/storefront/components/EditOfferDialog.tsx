import { useEffect, useState, type FormEvent } from 'react';
import {
  Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, MenuItem, Stack, TextField,
} from '@mui/material';
import { storefrontStrings } from '../strings';
import { STOREFRONT_RANGES, type StorefrontCategory, type StorefrontOffer, type UpdateStorefrontOfferInput } from '../types';
import { editFormFromOffer, editOfferPatch, pageCategoryOptions, validateEditOffer, type EditOfferForm } from '../offerForm';

const t = storefrontStrings.editOffer;
const NONE = '';
const EMPTY: EditOfferForm = { title: '', price: '', originalPrice: '', category: null };

export interface EditOfferDialogProps {
  /** null = fechado. */
  offer: StorefrontOffer | null;
  categories: readonly StorefrontCategory[];
  selectedCategories: readonly string[];
  onClose: () => void;
  /** Recebe só o que mudou (preços em centavos); quem chama trata erro. Sem mudança, só fecha. */
  onSave: (offerId: string, input: UpdateStorefrontOfferInput) => Promise<void>;
}

/** Editar título, preço, preço "de" e categoria. O link não muda (apague e cole de novo). */
export function EditOfferDialog({ offer, categories, selectedCategories, onClose, onSave }: EditOfferDialogProps) {
  const [form, setForm] = useState<EditOfferForm>(EMPTY);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (offer) setForm(editFormFromOffer(offer));
    setTouched(false);
  }, [offer]);

  const errors = touched ? validateEditOffer(form) : {};
  const options = pageCategoryOptions(categories, selectedCategories);
  // Categoria antiga que saiu da página continua visível para não sumir do select.
  const legacy = form.category && !options.some((c) => c.key === form.category) ? categories.find((c) => c.key === form.category) : undefined;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!offer || saving) return;
    setTouched(true);
    if (Object.keys(validateEditOffer(form)).length) return;
    const patch = editOfferPatch(offer, form);
    if (!patch) return onClose();
    setSaving(true);
    try {
      await onSave(offer.id, patch);
    } finally {
      setSaving(false);
    }
  };

  const set = (p: Partial<EditOfferForm>) => setForm((f) => ({ ...f, ...p }));
  const money = { input: { startAdornment: <InputAdornment position="start">R$</InputAdornment> }, htmlInput: { inputMode: 'decimal' as const } };

  return (
    <Dialog open={offer !== null} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="edit-offer-title">
      <form onSubmit={(e) => void submit(e)} noValidate>
        <DialogTitle id="edit-offer-title" sx={{ fontWeight: 700 }}>{t.title}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label={t.titleLabel}
              value={form.title}
              onChange={(e) => set({ title: e.target.value })}
              error={Boolean(errors.title)}
              helperText={errors.title ? t.titleInvalid : `${form.title.trim().length}/${STOREFRONT_RANGES.offerTitleMax}`}
              multiline
              maxRows={3}
              fullWidth
              autoFocus
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label={t.priceLabel}
                value={form.price}
                onChange={(e) => set({ price: e.target.value })}
                error={Boolean(errors.price)}
                helperText={errors.price ? t.priceInvalid : undefined}
                slotProps={money}
                fullWidth
              />
              <TextField
                label={t.originalPriceLabel}
                value={form.originalPrice}
                onChange={(e) => set({ originalPrice: e.target.value })}
                error={Boolean(errors.originalPrice)}
                helperText={errors.originalPrice ? t.priceInvalid : undefined}
                slotProps={money}
                fullWidth
              />
            </Stack>
            <TextField
              select
              label={t.categoryLabel}
              value={form.category ?? NONE}
              onChange={(e) => set({ category: e.target.value === NONE ? null : e.target.value })}
              fullWidth
            >
              <MenuItem value={NONE}>{storefrontStrings.addOffer.noCategory}</MenuItem>
              {legacy && <MenuItem value={legacy.key}>{legacy.label}</MenuItem>}
              {options.map((c) => <MenuItem key={c.key} value={c.key}>{c.label}</MenuItem>)}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} color="inherit" disabled={saving}>{t.cancel}</Button>
          <Button
            type="submit"
            variant="contained"
            disableElevation
            disabled={saving}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {t.save}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
