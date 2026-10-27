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
import { usePersistedState } from '@/hooks/usePersistedState';

interface FormDraft {
  url: string;
  hasCoupon: boolean;
  coupon: string;
  audience: OfferAudience;
}

const EMPTY_FORM: FormDraft = { url: '', hasCoupon: false, coupon: '', audience: 'STANDARD' };

const t = offerStrings.form;
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
}

/** Card "Gerar nova oferta": link próprio + cupom opcional + público-alvo. */
export function OfferGeneratorForm({ generating, serverError, disabled, disabledReason, onGenerate, onChange }: Props) {
  // Sobrevive a reload (padrão do painel): link colado, cupom e público ficam na aba
  const [form, setForm] = usePersistedState<FormDraft>('offers.form', EMPTY_FORM);
  const { url, hasCoupon, coupon, audience } = form;
  const setUrl = (v: string) => setForm((f) => ({ ...f, url: v }));
  const setHasCoupon = (v: boolean) => setForm((f) => ({ ...f, hasCoupon: v }));
  const setCoupon = (v: string) => setForm((f) => ({ ...f, coupon: v }));
  const setAudience = (v: OfferAudience) => setForm((f) => ({ ...f, audience: v }));
  const [linkError, setLinkError] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

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
    setLinkError(linkMsg);
    setCouponError(couponMsg);
    if (linkMsg || couponMsg) return;
    try {
      await onGenerate({ url: url.trim(), audience, coupon: hasCoupon ? coupon.trim() : undefined });
      setUrl('');
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
