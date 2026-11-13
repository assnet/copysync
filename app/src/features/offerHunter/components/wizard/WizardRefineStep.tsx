import { useId } from 'react';
import { Box, FormControlLabel, Stack, Switch, Tooltip, Typography } from '@mui/material';
import { RangeSlider, ToggleOption } from '@/components';
import type { HuntFilters, HuntOptions } from '../../types';
import { offerHunterStrings as t } from '../../strings';
import { formatCentsWhole } from '../../format';
import { PRICE_MAX_CENTS, PRICE_STEP_CENTS, type FieldErrors, type HuntWizardDraft } from './wizardDraft';
import { FieldHeading, NumberField } from './fields';
import { CommissionFilterField } from './CommissionFilterField';

const r = t.wizard.refine;
const tips = t.wizard.tips;
const wz = t.wizard;

interface Props {
  draft: HuntWizardDraft;
  options: HuntOptions;
  errors: FieldErrors;
  onChange: (patch: Partial<HuntWizardDraft>) => void;
}

/** Passo 2: faixa de preço, comissão % (condição + barra), mínimos, comissão extra, IA, ofertas por busca e repetição. */
export function WizardRefineStep({ draft, options, errors, onChange }: Props) {
  const priceHelpId = useId();
  const { limits, gates } = options;
  const f = draft.filters;
  // Mexer em filtro sai da predefinição (ela vira "Personalizada")
  const setFilter = (patch: Partial<HuntFilters>) => onChange({ filters: { ...f, ...patch }, preset: 'CUSTOM' });
  const lo = f.minPriceCents ?? 0;
  const hi = Math.min(f.maxPriceCents ?? PRICE_MAX_CENTS, PRICE_MAX_CENTS);
  const fmtPrice = (c: number) => (c >= PRICE_MAX_CENTS ? wz.priceMaxOpen(formatCentsWhole(c)) : formatCentsWhole(c));
  const anyPrice = lo === 0 && hi >= PRICE_MAX_CENTS;
  const err = (k: keyof HuntFilters) => errors[`filters.${k}`];

  const aiSwitch = (
    <FormControlLabel
      control={(
        <Switch
          checked={draft.aiEnabled && gates.aiAvailable}
          disabled={!gates.aiAvailable}
          onChange={(_e, v) => onChange({ aiEnabled: v })}
        />
      )}
      label={<Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{r.ai}</Typography>}
      sx={{ ml: 0, gap: 1 }}
    />
  );

  return (
    <Stack spacing={3}>
      <Box>
        <FieldHeading label={r.price} tip={tips.price} />
        <RangeSlider
          value={[lo, hi]}
          onChange={([nlo, nhi]) => setFilter({ minPriceCents: nlo <= 0 ? null : nlo, maxPriceCents: nhi >= PRICE_MAX_CENTS ? null : nhi })}
          min={0}
          max={PRICE_MAX_CENTS}
          step={PRICE_STEP_CENTS}
          minDistance={PRICE_STEP_CENTS}
          ariaLabel={r.price}
          formatValue={fmtPrice}
          error={Boolean(err('maxPriceCents') || err('minPriceCents'))}
          describedBy={priceHelpId}
        />
        <Typography id={priceHelpId} variant="caption" component="p" color={err('maxPriceCents') ? 'error' : 'text.secondary'}>
          {err('maxPriceCents') ?? err('minPriceCents') ?? (anyPrice ? r.priceAny : ' ')}
        </Typography>
      </Box>

      <CommissionFilterField filters={f} error={err('minCommissionPct') ?? err('commissionOperator')} onChange={setFilter} />

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
        <NumberField label={r.minDiscount} value={f.minDiscountPct} onChange={(v) => setFilter({ minDiscountPct: v })} tip={tips.minDiscount} suffix={wz.percentUnit} placeholder={r.noFilter} error={err('minDiscountPct')} />
        <NumberField label={r.minCommissionValue} value={f.minCommissionCents} onChange={(v) => setFilter({ minCommissionCents: v == null ? null : Math.round(v) })} tip={tips.minCommissionValue} scale={100} decimals prefix={wz.currencyUnit} placeholder={r.noFilter} error={err('minCommissionCents')} />
        <NumberField label={r.minRating} value={f.minRating} onChange={(v) => setFilter({ minRating: v })} tip={tips.minRating} decimals suffix={wz.ratingUnit} placeholder={r.noFilter} error={err('minRating')} />
        <NumberField label={r.minSales} value={f.minSales} onChange={(v) => setFilter({ minSales: v })} tip={tips.minSales} placeholder={r.noFilter} error={err('minSales')} />
        <NumberField label={r.minReviews} value={f.minReviews} onChange={(v) => setFilter({ minReviews: v })} tip={tips.minReviews} placeholder={r.noFilter} error={err('minReviews')} />
        <NumberField label={r.endsWithin} value={f.endsWithinDays} onChange={(v) => setFilter({ endsWithinDays: v })} tip={tips.endsWithin} suffix={wz.daysUnit} placeholder={r.noFilter} error={err('endsWithinDays')} helperText={t.wizard.validation.range(1, limits.endsWithinDaysMax)} />
      </Box>

      <ToggleOption
        checked={f.onlyWithExtra === true}
        onChange={(v) => setFilter({ onlyWithExtra: v ? true : null })}
        title={r.onlyWithExtra}
        description={r.onlyWithExtraHint}
      />

      <Box sx={{ borderRadius: 2, border: '1px solid', borderColor: 'divider', px: 1.5, py: 1 }}>
        {gates.aiAvailable ? aiSwitch : (
          <Tooltip title={r.aiUnavailable} arrow describeChild enterTouchDelay={0}>
            <Box component="span" sx={{ display: 'inline-flex' }}>{aiSwitch}</Box>
          </Tooltip>
        )}
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.25 }}>
          {gates.aiAvailable ? r.aiHint : r.aiUnavailable}
        </Typography>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
        <NumberField label={r.topN} value={draft.topN} onChange={(v) => onChange({ topN: v })} tip={tips.topN} error={errors.topN} helperText={r.topNHelp(limits.topNMax)} />
        <NumberField
          label={r.repeatAfter}
          value={draft.repeatAfterDays}
          onChange={(v) => onChange({ repeatAfterDays: v })}
          tip={tips.repeatAfter}
          suffix={wz.daysUnit}
          error={errors.repeatAfterDays}
          helperText={t.wizard.validation.range(limits.repeatAfterDaysMin, limits.repeatAfterDaysMax)}
        />
      </Box>
    </Stack>
  );
}
