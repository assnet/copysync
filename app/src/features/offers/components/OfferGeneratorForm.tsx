import { useState, type FormEvent } from 'react';
import {
  Box, Button, Chip, CircularProgress, Collapse, FormControlLabel, IconButton, InputAdornment, Stack, Switch, TextField, Tooltip, Typography,
} from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import CloseIcon from '@mui/icons-material/Close';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { SectionCard } from '@/components';
import type { GenerateOfferRequest, OfferAudience } from '@/types/api.types';
import { AFFILIATE_PROVIDERS } from '@/features/settings/affiliateProviders';
import { MarketplaceLogo } from '@/features/settings/components/MarketplaceLogo';
import { offerStrings } from '../strings';
import { detectStore, linkProblem } from '../utils/offerStore';
import { AudiencePicker } from './AudiencePicker';
import { OfferScheduleField } from './OfferScheduleField';
import { SCHEDULE_MAX_DAYS, defaultScheduleInput, fromLocalInput, scheduleProblem } from '../utils/offerSchedule';
import { usePersistedState } from '@/hooks/usePersistedState';

interface FormDraft {
  url: string;
  hasCoupon: boolean;
  coupon: string;
  audience: OfferAudience;
  scheduleOn: boolean;
  /** Valor do `datetime-local` (hora local). */
  scheduleAt: string;
}

const EMPTY_FORM: FormDraft = { url: '', hasCoupon: false, coupon: '', audience: 'STANDARD', scheduleOn: false, scheduleAt: '' };

const t = offerStrings.form;
const ts = offerStrings.schedule;
const COUPON_MAX = 40;

interface Props {
  generating: boolean;
  /** Erro do servidor para o campo de link (ex.: link de outro afiliado). */
  serverError: string | null;
  disabled?: boolean;
  /** Motivo de `disabled`, mostrado sob o botão. */
  disabledReason?: string | null;
  onGenerate: (body: GenerateOfferRequest) => Promise<void>;
  onChange?: () => void;
  /** Volta para a oferta aberta sem gerar outra (só quando há uma). */
  onCancel?: () => void;
}

/** Card "Gerar nova oferta": link próprio + cupom opcional + público-alvo + início agendado. */
export function OfferGeneratorForm({ generating, serverError, disabled, disabledReason, onGenerate, onChange, onCancel }: Props) {
  // Sobrevive a reload (padrão do painel): link colado, cupom e público ficam na aba
  const [form, setForm] = usePersistedState<FormDraft>('offers.form', EMPTY_FORM);
  // Rascunho antigo (antes do agendamento) não tem os campos novos
  const { url, hasCoupon, coupon, audience, scheduleOn = false, scheduleAt = '' } = form;
  const setUrl = (v: string) => setForm((f) => ({ ...f, url: v }));
  const setHasCoupon = (v: boolean) => setForm((f) => ({ ...f, hasCoupon: v }));
  const setCoupon = (v: string) => setForm((f) => ({ ...f, coupon: v }));
  const setAudience = (v: OfferAudience) => setForm((f) => ({ ...f, audience: v }));
  const [linkError, setLinkError] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const toggleSchedule = (on: boolean) => {
    setForm((f) => ({ ...f, scheduleOn: on, scheduleAt: on && !f.scheduleAt ? defaultScheduleInput() : f.scheduleAt }));
    setScheduleError(null);
  };
  const setScheduleAt = (v: string) => { setForm((f) => ({ ...f, scheduleAt: v })); setScheduleError(null); };

  const store = detectStore(url);
  const spec = store ? AFFILIATE_PROVIDERS.find((p) => p.provider === store) : undefined;
  const error = linkError ?? serverError;
  const busy = disabled || generating;

  const changeUrl = (value: string) => {
    setUrl(value);
    setLinkError(null);
    onChange?.();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = linkProblem(url);
    const linkMsg = problem === 'required' ? t.linkRequired : problem === 'invalid' ? t.linkInvalid : problem ? t.linkUnknownStore : null;
    const couponMsg = hasCoupon && !coupon.trim() ? t.couponRequired : null;
    const when = scheduleOn ? scheduleProblem(scheduleAt) : null;
    const scheduleMsg = when === 'required' ? ts.required : when === 'past' ? ts.past : when === 'too_far' ? ts.tooFar(SCHEDULE_MAX_DAYS) : null;
    setLinkError(linkMsg);
    setCouponError(couponMsg);
    setScheduleError(scheduleMsg);
    if (linkMsg || couponMsg || scheduleMsg) return;
    try {
      await onGenerate({
        url: url.trim(),
        audience,
        coupon: hasCoupon ? coupon.trim() : undefined,
        scheduledAt: scheduleOn ? fromLocalInput(scheduleAt) ?? undefined : undefined,
      });
      setForm((f) => ({ ...f, url: '', scheduleOn: false, scheduleAt: '' }));
    } catch {
      // A mensagem vem do hook (`serverError` ou alerta da página).
    }
  };

  return (
    <SectionCard title={t.title}>
      <Box component="form" noValidate onSubmit={(e) => void submit(e)}>
        <Stack spacing={2.5}>
          <Box>
            <TextField
              fullWidth
              label={t.linkLabel}
              placeholder={t.linkPlaceholder}
              value={url}
              disabled={busy}
              onChange={(e) => changeUrl(e.target.value)}
              error={Boolean(error)}
              helperText={error ?? t.linkHelper}
              inputMode="url"
              autoComplete="off"
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <LinkIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                    </InputAdornment>
                  ),
                  endAdornment: url ? (
                    <InputAdornment position="end">
                      <Tooltip title={t.clear}>
                        <IconButton size="small" aria-label={t.clear} onClick={() => changeUrl('')} edge="end">
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </InputAdornment>
                  ) : undefined,
                },
              }}
            />
            <Collapse in={Boolean(spec)} unmountOnExit>
              {spec && (
                <Box sx={{ mt: 1.25, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Chip
                    role="status"
                    icon={<MarketplaceLogo src={spec.logo} size={20} sx={{ ml: 0.5, p: 0.25 }} />}
                    label={t.detected(spec.name)}
                    color="success"
                    variant="outlined"
                    size="small"
                    sx={{ fontWeight: 600 }}
                  />
                  {store === 'SHOPEE' && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <InfoOutlinedIcon sx={{ fontSize: 16 }} aria-hidden />
                      {t.shopeeNotice}
                    </Typography>
                  )}
                </Box>
              )}
            </Collapse>
          </Box>

          {/* Campo na mesma linha do toggle; em tela estreita desce para a linha de baixo */}
          <Box sx={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', columnGap: 3, rowGap: 1 }}>
            <FormControlLabel
              sx={{ mr: 0, minHeight: 40 }}
              control={
                <Switch
                  checked={hasCoupon}
                  disabled={busy}
                  onChange={(e) => { setHasCoupon(e.target.checked); setCouponError(null); }}
                />
              }
              label={t.couponSwitch}
            />
            <Collapse in={hasCoupon} orientation="horizontal" unmountOnExit sx={{ flex: '1 1 260px', maxWidth: 320 }}>
              <TextField
                fullWidth
                size="small"
                label={t.couponLabel}
                placeholder={t.couponPlaceholder}
                value={coupon}
                disabled={busy}
                error={Boolean(couponError)}
                helperText={couponError ?? undefined}
                onChange={(e) => { setCoupon(e.target.value.toUpperCase()); setCouponError(null); }}
                autoComplete="off"
                slotProps={{ htmlInput: { maxLength: COUPON_MAX, style: { fontFamily: 'monospace', letterSpacing: 1 } } }}
              />
            </Collapse>
          </Box>

          <Box>
            <Typography variant="subtitle2" component="p">{t.audienceLabel}</Typography>
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1.25 }}>{t.audienceHelper}</Typography>
            <AudiencePicker value={audience} onChange={setAudience} disabled={busy} label={t.audienceLabel} />
          </Box>

          <OfferScheduleField
            enabled={scheduleOn}
            value={scheduleAt}
            onToggle={toggleSchedule}
            onChange={setScheduleAt}
            error={scheduleError}
            disabled={busy}
          />

          <Box>
            <Button
              type="submit"
              variant="contained"
              size="large"
              disableElevation
              fullWidth
              disabled={busy}
              startIcon={generating ? <CircularProgress size={18} color="inherit" /> : <AutoAwesomeOutlinedIcon />}
              aria-live="polite"
            >
              {generating ? t.generating : t.submit}
            </Button>
            {onCancel && (
              <Button fullWidth color="inherit" onClick={onCancel} disabled={generating} sx={{ mt: 1 }}>
                {t.backToOffer}
              </Button>
            )}
            {disabledReason && (
              <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.75, textAlign: 'center' }}>
                {disabledReason}
              </Typography>
            )}
          </Box>
        </Stack>
      </Box>
    </SectionCard>
  );
}
