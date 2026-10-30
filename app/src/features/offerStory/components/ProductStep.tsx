import { Alert, Box, Button, Collapse, InputAdornment, Stack, Switch, TextField, Typography, alpha, useTheme } from '@mui/material';
import { ArrowLeft, Image as ImageIcon, ImagePlus, Link2, Repeat2, Tag, Ticket, Type } from 'lucide-react';
import { AppIcon } from '@/components';
import { useBlur } from '@/features/privacy';
import { OFFER_STORY_RULES } from '../productForm.rules';
import type { ProductFormErrors, ProductFormState } from '../productForm';
import { offerStoryStrings } from '../strings';
import { storyGradient, storyWash } from '../storyStyle';
import { templateThumbnail, type OfferStoryTemplate } from '../types';
import { DeviceFrame } from './DeviceFrame';

const t = offerStoryStrings.product;
const SLOT_ICONS = [ImageIcon, Type, Tag] as const;

interface Props {
  form: ProductFormState;
  errors: ProductFormErrors;
  generalError: string | null;
  onDismissError: () => void;
  generating: boolean;
  /** Template escolhido no passo 1, para a prévia (null enquanto o catálogo carrega). */
  template: OfferStoryTemplate | null;
  onChange: <K extends keyof ProductFormState>(field: K, value: ProductFormState[K]) => void;
  onBack: () => void;
  onGenerate: () => void;
}

/** Prévia do template escolhido (md+ ao lado do formulário; xs some para o botão caber). */
function TemplatePreview({ template, onBack, disabled }: { template: OfferStoryTemplate | null; onBack: () => void; disabled: boolean }) {
  const theme = useTheme();
  return (
    <Box
      component="aside"
      aria-label={t.previewTitle}
      sx={{
        display: { xs: 'none', md: 'flex' }, flexDirection: 'column', alignItems: 'center', gap: 2.5,
        p: 3, borderRadius: '20px', border: '1px solid', borderColor: 'divider', backgroundImage: storyWash(theme),
      }}
    >
      <Box sx={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t.previewTitle}</Typography>
          {template && <Typography variant="body2" color="text.secondary" noWrap>{template.name}</Typography>}
        </Box>
        <Button size="small" color="inherit" startIcon={<AppIcon icon={Repeat2} size="sm" />} onClick={onBack} disabled={disabled} sx={{ flexShrink: 0, borderRadius: 999 }}>
          {t.changeTemplate}
        </Button>
      </Box>

      <DeviceFrame maxWidth={210}>
        {template && (
          <Box component="img" src={templateThumbnail(template.id)} alt="" draggable={false} sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        )}
      </DeviceFrame>

      <Box sx={{ width: '100%' }}>
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mb: 1.5 }}>{t.previewHint}</Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ justifyContent: 'center', flexWrap: 'wrap' }}>
          {t.previewSlots.map((slot, i) => (
            <Box
              key={slot}
              sx={{
                display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.5, borderRadius: 999,
                fontSize: '0.75rem', fontWeight: 600, color: 'text.primary',
                bgcolor: alpha(theme.palette.background.paper, 0.8), border: '1px solid', borderColor: 'divider',
              }}
            >
              <AppIcon icon={SLOT_ICONS[i]} size="sm" aria-hidden />
              {slot}
            </Box>
          ))}
        </Stack>
      </Box>
    </Box>
  );
}

/** Passo 2: link do produto e cupom opcional, com prévia do visual. Erro da API aparece no campo. */
export function ProductStep({ form, errors, generalError, onDismissError, generating, template, onChange, onBack, onGenerate }: Props) {
  const theme = useTheme();
  const blurLink = useBlur('offerStory.link');
  const { primary, secondary } = theme.palette;

  return (
    <Box sx={{ display: 'grid', gap: { xs: 3, md: 4 }, gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) 340px' }, alignItems: 'start' }}>
      <Box
        component="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onGenerate();
        }}
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
              input: { startAdornment: <InputAdornment position="start"><AppIcon icon={Link2} size="sm" /></InputAdornment>, sx: { borderRadius: '16px', minHeight: 56 } },
              htmlInput: { maxLength: 2048, spellCheck: false, 'data-blurred': blurLink ? 'true' : undefined },
            }}
            // Borrar só o texto: o campo continua editável (Blurred bloquearia o clique).
            sx={blurLink ? { '& input': { filter: 'blur(5px)' } } : undefined}
          />

          <Box
            sx={{
              p: { xs: 2, sm: 2.5 }, borderRadius: '16px', border: '1px solid',
              borderColor: form.couponEnabled ? alpha(secondary.main, 0.5) : 'divider',
              bgcolor: form.couponEnabled ? alpha(secondary.main, theme.palette.mode === 'dark' ? 0.08 : 0.04) : 'transparent',
              transition: theme.transitions.create(['border-color', 'background-color'], { duration: 200 }),
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box
                aria-hidden
                sx={{
                  width: 44, height: 44, borderRadius: '12px', display: 'grid', placeItems: 'center', flexShrink: 0,
                  color: form.couponEnabled ? primary.contrastText : 'text.secondary',
                  backgroundImage: form.couponEnabled ? storyGradient(theme, 135) : 'none',
                  bgcolor: alpha(theme.palette.text.primary, 0.06),
                }}
              >
                <AppIcon icon={Ticket} size="md" />
              </Box>
              <Box component="label" htmlFor="offer-story-coupon" sx={{ flex: 1, minWidth: 0, cursor: generating ? 'default' : 'pointer' }}>
                <Typography sx={{ fontWeight: 700 }}>{t.couponToggle}</Typography>
                <Typography variant="body2" color="text.secondary">{t.couponHint}</Typography>
              </Box>
              <Switch id="offer-story-coupon" checked={form.couponEnabled} onChange={(_, v) => onChange('couponEnabled', v)} disabled={generating} />
            </Box>
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
                  slotProps={{ htmlInput: { maxLength: OFFER_STORY_RULES.couponMax, spellCheck: false, style: { fontWeight: 700, letterSpacing: '0.06em' } } }}
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

          <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'space-between', alignItems: 'center', pt: 1 }}>
            <Button color="inherit" startIcon={<AppIcon icon={ArrowLeft} size="sm" />} onClick={onBack} disabled={generating} sx={{ borderRadius: 999 }}>
              {t.back}
            </Button>
            <Button
              type="submit"
              variant="contained"
              size="large"
              disableElevation
              startIcon={<AppIcon icon={ImagePlus} size="sm" />}
              disabled={generating}
              sx={{
                px: 3.5, borderRadius: 999, fontWeight: 700,
                backgroundImage: `linear-gradient(135deg, ${primary.main}, ${secondary.main})`,
                boxShadow: `0 10px 24px -12px ${alpha(secondary.main, 0.9)}`,
                '&:hover': { backgroundImage: `linear-gradient(135deg, ${primary.dark}, ${secondary.dark})` },
              }}
            >
              {t.generate}
            </Button>
          </Stack>
        </Stack>
      </Box>

      <TemplatePreview template={template} onBack={onBack} disabled={generating} />
    </Box>
  );
}
