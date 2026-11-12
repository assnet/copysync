import { useState, type ReactNode } from 'react';
import { alpha, Box, Card, CardContent, Chip, Stack, TableContainer, Tooltip, Typography, type Theme } from '@mui/material';
import type { LucideIcon } from 'lucide-react';
import { AppIcon } from '@/components';
import { HelpTip } from '@/features/opsMetrics/components/HelpTip';
import { formatBrl, formatUsd } from '../rules';
import { infraCostsStrings as S } from '../strings';
import type { InfraMoney } from '../types';

const s = S.summary;

type Tone = 'success' | 'error' | 'warning' | 'info';

/** Cor de texto legível nos dois temas: tom `.dark` no claro, `.main` no escuro (sem hex fixo). */
export const toneColor = (tone: Tone) => (t: Theme) => (t.palette.mode === 'light' ? t.palette[tone].dark : t.palette[tone].main);

/** Foco visível para elementos com `tabIndex` (chips, cabeçalhos com dica). */
export const focusRing = { '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } } as const;

/** Texto só para leitor de tela. */
export const srOnly = {
  position: 'absolute', width: 1, height: 1, p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
} as const;

/** USD e BRL lado a lado (BRL some sem cotação). `null` = sem valor ("—"). `strong` = total em destaque. */
export function Money({
  value, size = 'body', signed = false, strong = false,
}: { value: InfraMoney | null; size?: 'body' | 'large'; signed?: boolean; strong?: boolean }) {
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
      <Typography
        component="span"
        variant={large ? 'h5' : 'body2'}
        sx={{ fontWeight: large || strong ? 700 : 600, whiteSpace: 'nowrap', ...(strong && { color: 'text.primary' }) }}
      >
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
  const tone = color === 'default' ? null : toneColor(color);
  return (
    <Tooltip title={hint} arrow enterTouchDelay={0} describeChild>
      <Chip
        label={label}
        size="small"
        variant="outlined"
        color={color}
        tabIndex={0}
        sx={[
          { height: 20, fontSize: 11, cursor: 'help' },
          focusRing,
          tone ? (t: Theme) => ({ color: tone(t), borderColor: tone(t) }) : {},
        ]}
      />
    </Tooltip>
  );
}

export function EstimatedChip({ hint = s.services.estimatedHint }: { hint?: string }) {
  return <HintChip label={S.estimated} hint={hint} color="info" />;
}

/** Cabeçalho de coluna com Tooltip (sublinhado pontilhado). */
export function HeaderHint({ label, hint }: { label: string; hint: string }) {
  return (
    <Tooltip title={hint} arrow enterTouchDelay={0} describeChild>
      <Box
        component="span"
        tabIndex={0}
        sx={{ borderBottom: 1, borderBottomStyle: 'dotted', borderBottomColor: 'text.disabled', cursor: 'help', ...focusRing }}
      >
        {label}
      </Box>
    </Tooltip>
  );
}

/**
 * Tabela com rolagem lateral e a primeira coluna fixa (celular): fundo do card e sombra à direita
 * enquanto o conteúdo estiver rolado.
 */
export function StickyFirstColumn({ children }: { children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  return (
    <TableContainer
      onScroll={(e) => setScrolled(e.currentTarget.scrollLeft > 0)}
      data-scrolled={scrolled ? 'true' : 'false'}
      sx={{
        '& tr > :first-of-type': {
          position: 'sticky',
          left: 0,
          zIndex: 1,
          bgcolor: 'background.paper',
          transition: 'box-shadow 0.15s ease',
          boxShadow: (t: Theme) => (scrolled ? `4px 0 6px -4px ${alpha(t.palette.common.black, t.palette.mode === 'dark' ? 0.7 : 0.25)}` : 'none'),
        },
      }}
    >
      {children}
    </TableContainer>
  );
}

export interface CostTileProps {
  label: string;
  help: string;
  icon: LucideIcon;
  /** `null` = sem valor: mostra `emptyText` (padrão "sem amostra"). */
  value: InfraMoney | null;
  /** Texto do valor ausente, pelo motivo (sem amostra × sem preço). */
  emptyText?: string;
  context?: string | null;
  badge?: ReactNode;
}

/** Cartão do resumo: rótulo com ajuda, valor em USD e BRL e contexto. */
export function CostTile({ label, help, icon, value, emptyText = S.noSample, context, badge }: CostTileProps) {
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
            <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 500 }}>{emptyText}</Typography>
          )}
        </Box>
        {context && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{context}</Typography>}
      </CardContent>
    </Card>
  );
}
