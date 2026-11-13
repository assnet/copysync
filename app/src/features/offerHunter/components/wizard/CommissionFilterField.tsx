import { useId } from 'react';
import { Box, Chip, MenuItem, Slider, Stack, TextField, Typography } from '@mui/material';
import { HUNT_COMMISSION_OPERATORS, HUNT_COMMISSION_PCT_MAX, type HuntCommissionOperator, type HuntFilters } from '../../types';
import { offerHunterStrings as t } from '../../strings';
import { formatDecimal } from '../../format';
import { FieldHeading } from './fields';

const r = t.wizard.refine;
/** Atalhos clicáveis sob a barra. */
export const COMMISSION_SHORTCUTS = [5, 10, 15, 20, 30] as const;
/** Valor inicial ao sair de "Qualquer comissão". */
const DEFAULT_PCT = 15;
const ANY = 'ANY';

interface Props {
  filters: Pick<HuntFilters, 'minCommissionPct' | 'commissionOperator'>;
  error?: string;
  onChange: (patch: Pick<HuntFilters, 'minCommissionPct' | 'commissionOperator'>) => void;
}

/**
 * Filtro de comissão % (cliente novo): condição por extenso (símbolo ao lado) + barra 0–50, passo 1, com valor
 * visível e atalhos. "Qualquer comissão" = sem filtro (percentual e operador null).
 */
export function CommissionFilterField({ filters, error, onChange }: Props) {
  const headingId = useId();
  const helpId = useId();
  const op = filters.minCommissionPct == null ? null : (filters.commissionOperator ?? 'GTE');
  const pct = filters.minCommissionPct ?? DEFAULT_PCT;
  /** Valor legado salvo acima do teto: rótulo mostra o real, a barra fica presa no teto com aviso. */
  const aboveMax = op !== null && pct > HUNT_COMMISSION_PCT_MAX;
  const sliderPct = Math.min(Math.max(pct, 0), HUNT_COMMISSION_PCT_MAX);
  const setOp = (value: string) => {
    if (value === ANY) onChange({ minCommissionPct: null, commissionOperator: null });
    else onChange({ minCommissionPct: filters.minCommissionPct ?? DEFAULT_PCT, commissionOperator: value as HuntCommissionOperator });
  };
  const setPct = (value: number) => onChange({ minCommissionPct: value, commissionOperator: op ?? 'GTE' });
  const opLabel = (o: HuntCommissionOperator) => `${r.commissionOperators[o].label} (${r.commissionOperators[o].symbol})`;

  return (
    <Box role="group" aria-labelledby={headingId}>
      <FieldHeading id={headingId} label={r.commission} tip={t.wizard.tips.commission}>
        {op && (
          <Typography variant="subtitle2" component="span" color="primary" sx={{ ml: 'auto', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {`${r.commissionOperators[op].symbol} ${formatDecimal(pct)}%`}
          </Typography>
        )}
      </FieldHeading>
      <Stack spacing={1.5}>
        <TextField
          select
          size="small"
          label={r.commissionCondition}
          value={op ?? ANY}
          onChange={(e) => setOp(e.target.value)}
          fullWidth
          error={Boolean(error) || aboveMax}
        >
          <MenuItem value={ANY}>{r.commissionAny}</MenuItem>
          {HUNT_COMMISSION_OPERATORS.map((o) => <MenuItem key={o} value={o}>{opLabel(o)}</MenuItem>)}
        </TextField>
        <Box sx={{ px: 1 }}>
          <Slider
            value={sliderPct}
            min={0}
            max={HUNT_COMMISSION_PCT_MAX}
            step={1}
            disabled={!op}
            marks={COMMISSION_SHORTCUTS.map((value) => ({ value }))}
            valueLabelDisplay="auto"
            valueLabelFormat={(v) => `${v}%`}
            getAriaValueText={(v) => `${v}%`}
            onChange={(_e, v) => setPct(v as number)}
            slotProps={{ input: { 'aria-label': r.commissionPercent, 'aria-describedby': helpId } }}
          />
        </Box>
        <Box role="group" aria-label={r.commissionShortcuts} sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {COMMISSION_SHORTCUTS.map((n) => (
            <Chip
              key={n}
              size="small"
              label={`${n}%`}
              aria-label={r.commissionShortcutAria(n)}
              color={op && pct === n ? 'primary' : 'default'}
              variant={op && pct === n ? 'filled' : 'outlined'}
              onClick={() => setPct(n)}
            />
          ))}
        </Box>
        <Typography id={helpId} variant="caption" color={error || aboveMax ? 'error' : 'text.secondary'} component="p" data-testid="commission-help">
          {aboveMax
            ? r.commissionAboveMax(formatDecimal(pct), HUNT_COMMISSION_PCT_MAX)
            : error ?? (op ? t.wizard.validation.range(0, HUNT_COMMISSION_PCT_MAX) : r.commissionAnyHint)}
        </Typography>
      </Stack>
    </Box>
  );
}
