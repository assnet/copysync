import type { ReactNode } from 'react';
import { Box, Card, CardContent, Chip, Stack, Tooltip, Typography } from '@mui/material';
import type { LucideIcon } from 'lucide-react';
import { AppIcon } from '@/components';
import { HelpTip } from '@/features/opsMetrics/components/HelpTip';
import { formatBrl, formatUsd } from '../rules';
import { infraCostsStrings as S } from '../strings';
import type { InfraMoney } from '../types';

const s = S.summary;

/** USD e BRL lado a lado (BRL some sem cotação). `null` = sem valor ("—"). */
export function Money({ value, size = 'body', signed = false }: { value: InfraMoney | null; size?: 'body' | 'large'; signed?: boolean }) {
  if (!value) {
    return <Typography component="span" variant="body2" color="text.secondary">{S.noValue}</Typography>;
  }
  const sign = (n: number) => (signed && n > 0 ? '+' : '');
  const usd = `${sign(value.usd)}${formatUsd(value.usd)}`;
  const brl = value.brl === null ? null : `${sign(value.brl)}${formatBrl(value.brl)}`;
  const large = size === 'large';
  return (
    <Box
      component="span"
      sx={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 1, rowGap: 0, fontVariantNumeric: 'tabular-nums' }}
    >
      <Typography component="span" variant={large ? 'h5' : 'body2'} sx={{ fontWeight: large ? 700 : 600, whiteSpace: 'nowrap' }}>
        {usd}
      </Typography>
      {brl !== null && (
        <Typography component="span" variant={large ? 'body1' : 'caption'} color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          {brl}
        </Typography>
      )}
    </Box>
  );
}

/** Selo com explicação (estimado, a confirmar, parcial, fora do rateio). */
export function HintChip({ label, hint, color = 'default' }: { label: string; hint: string; color?: 'default' | 'warning' | 'info' }) {
  return (
    <Tooltip title={hint} arrow enterTouchDelay={0}>
      <Chip label={label} size="small" variant="outlined" color={color} tabIndex={0} sx={{ height: 20, fontSize: 11, cursor: 'help' }} />
    </Tooltip>
  );
}

export function EstimatedChip({ hint = s.services.estimatedHint }: { hint?: string }) {
  return <HintChip label={S.estimated} hint={hint} color="info" />;
}

/** Cabeçalho de coluna com Tooltip (sublinhado pontilhado). */
export function HeaderHint({ label, hint }: { label: string; hint: string }) {
  return (
    <Tooltip title={hint} arrow enterTouchDelay={0}>
      <Box component="span" tabIndex={0} sx={{ borderBottom: 1, borderBottomStyle: 'dotted', borderBottomColor: 'text.disabled', cursor: 'help' }}>
        {label}
      </Box>
    </Tooltip>
  );
}

export interface CostTileProps {
  label: string;
  help: string;
  icon: LucideIcon;
  /** `null` = sem valor (divisão por zero, sem amostra): mostra "sem amostra". */
  value: InfraMoney | null;
  context?: string | null;
  badge?: ReactNode;
}

/** Cartão do resumo: rótulo com ajuda, valor em USD e BRL e contexto. */
export function CostTile({ label, help, icon, value, context, badge }: CostTileProps) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', color: 'text.secondary' }}>
          <AppIcon icon={icon} size="inline" aria-hidden />
          <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{label}</Typography>
          {badge}
          <HelpTip label={label} text={help} />
        </Stack>
        <Box sx={{ mt: 1 }}>
          {value ? (
            <Money value={value} size="large" />
          ) : (
            <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 500 }}>{S.noSample}</Typography>
          )}
        </Box>
        {context && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{context}</Typography>}
      </CardContent>
    </Card>
  );
}
