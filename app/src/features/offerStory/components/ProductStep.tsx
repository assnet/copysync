import { Alert, Box, Button, Collapse, FormControlLabel, InputAdornment, Stack, Switch, TextField, Typography } from '@mui/material';
import { ArrowLeft, Link2, Sparkles } from 'lucide-react';
import { AppIcon } from '@/components';
import { useBlur } from '@/features/privacy';
import { OFFER_STORY_RULES } from '../productForm.rules';
import type { ProductFormErrors, ProductFormState } from '../productForm';
import { offerStoryStrings } from '../strings';

const t = offerStoryStrings.product;

interface Props {
  form: ProductFormState;
  errors: ProductFormErrors;
  generalError: string | null;
  onDismissError: () => void;
  generating: boolean;
  onChange: <K extends keyof ProductFormState>(field: K, value: ProductFormState[K]) => void;
  onBack: () => void;
  onGenerate: () => void;
}

/** Passo 2: link do produto e cupom opcional. Erro da API aparece no campo (fica neste passo). */
export function ProductStep({ form, errors, generalError, onDismissError, generating, onChange, onBack, onGenerate }: Props) {
  const blurLink = useBlur('offerStory.link');

  return (
    <Box
      component="form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onGenerate();
      }}
      sx={{ maxWidth: 640 }}
    >
      <Stack spacing={3}>
        <TextField
          label={t.linkLabel}
          placeholder={t.linkPlaceholder}
          value={form.url}
          onChange={(e) => onChange('url', e.target.value)}
          error={Boolean(errors.url)}
          helperText={errors.url ?? t.linkHelp}
          required
          fullWidth
          autoFocus={!form.url}
          inputMode="url"
          autoComplete="off"
          disabled={generating}
          slotProps={{
            input: { startAdornment: <InputAdornment position="start"><AppIcon icon={Link2} size="sm" /></InputAdornment> },
            htmlInput: { maxLength: 2048, spellCheck: false, 'data-blurred': blurLink ? 'true' : undefined },
          }}
          // Borrar só o texto: o campo continua editável (Blurred bloquearia o clique).
          sx={blurLink ? { '& input': { filter: 'blur(5px)' } } : undefined}
        />

        <Box sx={{ p: 2, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
          <FormControlLabel
            control={<Switch checked={form.couponEnabled} onChange={(_, v) => onChange('couponEnabled', v)} disabled={generating} />}
            label={<Typography sx={{ fontWeight: 600 }}>{t.couponToggle}</Typography>}
          />
          <Typography variant="body2" color="text.secondary" sx={{ ml: { xs: 0, sm: 6.5 } }}>{t.couponHint}</Typography>
          <Collapse in={form.couponEnabled} unmountOnExit>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2.5 }}>
              <TextField
                label={t.codeLabel}
                value={form.code}
                onChange={(e) => onChange('code', e.target.value.toUpperCase())}
                error={Boolean(errors.code)}
                helperText={errors.code ?? t.codeHelp}
                required
                disabled={generating}
                autoComplete="off"
                slotProps={{ htmlInput: { maxLength: OFFER_STORY_RULES.couponMax, spellCheck: false } }}
                sx={{ flex: 2 }}
              />
              <TextField
                label={t.discountLabel}
                value={form.discount}
                onChange={(e) => onChange('discount', e.target.value)}
                error={Boolean(errors.discount)}
                helperText={errors.discount ?? t.discountHelp}
                disabled={generating}
                inputMode="numeric"
                slotProps={{ input: { endAdornment: <InputAdornment position="end">%</InputAdornment> } }}
                sx={{ flex: 1 }}
              />
            </Stack>
          </Collapse>
        </Box>

        {generalError && <Alert severity="error" onClose={onDismissError}>{generalError}</Alert>}

        <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'space-between' }}>
          <Button color="inherit" startIcon={<AppIcon icon={ArrowLeft} size="sm" />} onClick={onBack} disabled={generating}>
            {t.back}
          </Button>
          <Button type="submit" variant="contained" disableElevation startIcon={<AppIcon icon={Sparkles} size="sm" />} disabled={generating}>
            {t.generate}
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
