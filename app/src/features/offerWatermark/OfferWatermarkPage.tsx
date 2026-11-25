import { useId } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, AlertTitle, Box, Button, Card, CardContent, CircularProgress, IconButton, Paper, Slider, Snackbar, Stack, TextField,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Image as ImageIcon, Info, Lock, Type } from 'lucide-react';
import { AppIcon, PageHeader, ToggleOption } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { PlanAvailabilityBadges } from '@/features/plans/components/PlanAvailabilityBadges';
import { PRODUCT_PLANS_PATH } from '@/features/products/productAccess';
import { ChannelLogo } from '@/features/sessions/components/ChannelLogo';
import { LogoUploader } from './components/LogoUploader';
import { PositionPicker } from './components/PositionPicker';
import { WatermarkPreview } from './components/WatermarkPreview';
import { useOfferWatermarkPage, type OfferWatermarkPageState } from './hooks/useOfferWatermarkPage';
import { WATERMARK_OPACITY_MAX, WATERMARK_OPACITY_MIN, WATERMARK_SIZES, WATERMARK_TEXT_MAX_LENGTH, textLength } from './rules';
import { offerWatermarkStrings } from './strings';
import type { WatermarkKind, WatermarkSize } from './types';

const t = offerWatermarkStrings;
const KIND_ICONS = { IMAGE: ImageIcon, TEXT: Type } as const;
export const OFFER_WATERMARK_UPGRADE_PATH = `${PRODUCT_PLANS_PATH.AFFILIATES}?feature=offerWatermark`;

const segmentSx = { flex: '1 1 0', minWidth: 0, minHeight: 44, gap: 0.75, textTransform: 'none', fontWeight: 600 } as const;

/** Rótulo de campo com tooltip de ajuda (ícone de informação com nome acessível). */
function FieldTitle({ id, label, help }: { id: string; label: string; help: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.75 }}>
      <Typography id={id} variant="subtitle2" component="span" sx={{ fontWeight: 600 }}>{label}</Typography>
      <Tooltip title={help} arrow enterTouchDelay={0} leaveTouchDelay={5000}>
        <IconButton size="small" aria-label={`${label}: ${help}`} sx={{ width: 32, height: 32, color: 'text.secondary' }}>
          <AppIcon icon={Info} size="sm" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

function LockedState() {
  return (
    <Card sx={{ borderRadius: '20px' }} data-testid="watermark-locked">
      <CardContent sx={{ p: { xs: 3, sm: 4 }, textAlign: 'center' }}>
        <Box sx={{ color: 'primary.main', display: 'inline-flex', mb: 1.5 }}><AppIcon icon={Lock} size="lg" /></Box>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700, display: 'flex', gap: 1, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
          {t.locked.title} <PlanAvailabilityBadges from="max" />
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2.5, maxWidth: 480, mx: 'auto' }}>{t.locked.description}</Typography>
        <Button component={RouterLink} to={OFFER_WATERMARK_UPGRADE_PATH} variant="contained" sx={{ minHeight: 44 }}>{t.locked.cta}</Button>
      </CardContent>
    </Card>
  );
}

function SettingsCard({ s }: { s: OfferWatermarkPageState }) {
  const kindId = useId();
  const positionId = useId();
  const sizeId = useId();
  const opacityId = useId();
  const textHelpId = useId();
  const blur = useBlur('offerWatermark.logo');
  const { value, canEdit, saved } = s;
  const disabled = !canEdit;
  const imageUrl = saved?.imageUrl ?? null;
  const textCount = textLength(value.text.trim());
  const textError = value.kind === 'TEXT' && s.problem ? t.text.errors[s.problem] : null;

  const textField = (
    <TextField
      label={t.text.label}
      placeholder={t.text.placeholder}
      value={value.text}
      // Uma linha só: quebra colada vira espaço
      onChange={(e) => s.patch({ text: e.target.value.replace(/[\r\n\u2028\u2029]+/g, ' ') })}
      disabled={disabled}
      fullWidth
      error={Boolean(textError)}
      helperText={textError ?? t.text.help}
      slotProps={{
        htmlInput: { 'aria-describedby': textHelpId },
        input: {
          endAdornment: (
            <Typography id={textHelpId} variant="caption" color={textCount > WATERMARK_TEXT_MAX_LENGTH ? 'error' : 'text.secondary'} sx={{ whiteSpace: 'nowrap', pl: 1 }}>
              {t.text.counter(textCount, WATERMARK_TEXT_MAX_LENGTH)}
            </Typography>
          ),
        },
      }}
      sx={blur ? { '& input': { filter: 'blur(5px)' } } : undefined}
    />
  );

  return (
    <Card sx={{ borderRadius: '20px' }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={3}>
          {!canEdit && <Alert severity="info" variant="outlined">{t.readOnly}</Alert>}

          <ToggleOption
            checked={value.enabled}
            onChange={(enabled) => s.patch({ enabled })}
            title={t.enabled.title}
            description={value.enabled ? t.enabled.on : t.enabled.off}
            disabled={disabled}
          />
          {value.enabled && value.kind === 'IMAGE' && !imageUrl && <Alert severity="warning">{t.enabled.missingLogo}</Alert>}

          <Box>
            <FieldTitle id={kindId} label={t.kind.label} help={t.kind.help} />
            <ToggleButtonGroup
              exclusive
              fullWidth
              size="small"
              color="primary"
              value={value.kind}
              disabled={disabled}
              aria-labelledby={kindId}
              onChange={(_, next: WatermarkKind | null) => { if (next) s.patch({ kind: next }); }}
            >
              {(['IMAGE', 'TEXT'] as const).map((kind) => (
                <ToggleButton key={kind} value={kind} sx={segmentSx}>
                  <AppIcon icon={KIND_ICONS[kind]} />
                  {t.kind.options[kind].label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.75 }}>{t.kind.options[value.kind].hint}</Typography>
          </Box>

          {value.kind === 'IMAGE' ? (
            <LogoUploader imageUrl={imageUrl} onUploaded={s.applyLogo} onRemove={s.removeLogo} disabled={disabled} />
          ) : disabled ? (
            <Blurred when={blur}>{textField}</Blurred>
          ) : textField}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3}>
            <Box>
              <FieldTitle id={positionId} label={t.position.label} help={t.position.help} />
              <PositionPicker value={value.position} onChange={(position) => s.patch({ position })} disabled={disabled} labelledBy={positionId} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <FieldTitle id={sizeId} label={t.size.label} help={t.size.help} />
              <ToggleButtonGroup
                exclusive
                fullWidth
                size="small"
                color="primary"
                value={value.size}
                disabled={disabled}
                aria-labelledby={sizeId}
                onChange={(_, next: WatermarkSize | null) => { if (next) s.patch({ size: next }); }}
              >
                {WATERMARK_SIZES.map((size) => (
                  <ToggleButton key={size} value={size} sx={segmentSx}>{t.size.options[size]}</ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>
          </Stack>

          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <FieldTitle id={opacityId} label={t.opacity.label} help={t.opacity.help} />
              <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{t.opacity.value(value.opacity)}</Typography>
            </Box>
            <Box sx={{ px: 1 }}>
              <Slider
                value={value.opacity}
                min={WATERMARK_OPACITY_MIN}
                max={WATERMARK_OPACITY_MAX}
                step={5}
                disabled={disabled}
                onChange={(_, v) => s.patch({ opacity: v as number })}
                getAriaValueText={t.opacity.value}
                slotProps={{ input: { 'aria-labelledby': opacityId } }}
              />
            </Box>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

function SaveBar({ s }: { s: OfferWatermarkPageState }) {
  const theme = useTheme();
  const show = s.dirty || Boolean(s.error);
  return (
    <Box aria-live="polite" sx={{ position: 'sticky', bottom: 'calc(16px + env(safe-area-inset-bottom))', zIndex: theme.zIndex.appBar - 1, mt: 3 }}>
      {show && (
        <Paper elevation={6} sx={{ p: 1.5, borderRadius: 3, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Typography role="status" variant="body2" sx={{ fontWeight: 600, flex: 1, minWidth: 160 }}>
            {s.error ?? t.save.unsaved}
          </Typography>
          <Button onClick={s.discard} disabled={s.saving} sx={{ minHeight: 44 }}>{t.save.discard}</Button>
          <Button
            variant="contained"
            onClick={() => void s.save()}
            disabled={s.saving || Boolean(s.problem) || !s.dirty}
            startIcon={s.saving ? <CircularProgress size={16} color="inherit" /> : undefined}
            sx={{ minHeight: 44 }}
          >
            {s.saving ? t.save.saving : t.save.save}
          </Button>
        </Paper>
      )}
    </Box>
  );
}

/** Página "Marca d'água" (produto Afiliados, só MAX): ajustes à esquerda, prévia ao vivo à direita. */
export function OfferWatermarkPage() {
  const s = useOfferWatermarkPage();

  return (
    <Box>
      <PageHeader title={t.page.title} subtitle={t.page.subtitle} />

      {s.status === 'loading' && (
        <Box role="status" aria-label={t.page.loading} sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress size={28} />
        </Box>
      )}
      {s.status === 'error' && (
        <Alert severity="error" action={<Button color="inherit" onClick={() => void s.reload()}>{t.page.retry}</Button>}>
          {t.page.loadError}
        </Alert>
      )}
      {s.status === 'locked' && <LockedState />}

      {s.status === 'ready' && (
        <>
          <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(280px, 380px)' }, alignItems: 'start' }}>
            <SettingsCard s={s} />
            <Stack spacing={2} sx={{ position: { md: 'sticky' }, top: { md: 88 } }}>
              <Card sx={{ borderRadius: '20px' }}>
                <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
                  <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700, mb: 1.5 }}>{t.preview.title}</Typography>
                  <WatermarkPreview value={s.value} imageUrl={s.saved?.imageUrl ?? null} />
                </CardContent>
              </Card>
              <Alert severity="info" variant="outlined" icon={<ChannelLogo channel="telegram" />}>
                <AlertTitle sx={{ fontWeight: 700 }}>{t.telegram.title}</AlertTitle>
                {t.telegram.body}
              </Alert>
            </Stack>
          </Box>
          {s.canEdit && <SaveBar s={s} />}
        </>
      )}

      <Snackbar open={s.savedToast} autoHideDuration={3000} onClose={s.closeToast} message={t.save.saved} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Box>
  );
}
