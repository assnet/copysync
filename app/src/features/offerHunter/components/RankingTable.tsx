import { Box, Button, Chip, CircularProgress, Stack, Tooltip, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Check, CheckCheck, MessageSquareText, Send } from 'lucide-react';
import { AppIcon } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import type { HuntRankingItem } from '../types';
import { commissionCopy, offerHunterStrings as t } from '../strings';
import { formatCents, formatDecimal } from '../format';
import { providerOf } from '../providers';
import { ProviderBadge } from './ProviderBadge';
import { EstimatedTag } from './EstimatedTag';
import { ProductThumb } from './ProductThumb';
import { ScoreBar } from './ScoreBar';

/** Ações de reaproveitar o ranking (execução com `runId`): "Enviar" nos não escolhidos, "Enviada" nos já enviados. */
export interface RankingReuseActions {
  sentProductIds: ReadonlySet<string>;
  /** false = execução com mais de 48 h: botões desabilitados com a explicação. */
  reusable: boolean;
  /** Produto sendo enviado agora (spinner nele). */
  busyProductId: string | null;
  /** Algum envio em andamento: todos os botões travam (sem envio duplo). */
  busy: boolean;
  onSend: (item: HuntRankingItem) => void;
}

/**
 * Ranking de uma busca, na ordem da pontuação: posição, foto, título, preço, pontuação (fatores no
 * Tooltip), se entrou no corte e o motivo da IA. Lista em vez de `<table>`: cabe no celular sem rolagem lateral.
 */
export function RankingTable({ items, reuse }: { items: HuntRankingItem[]; reuse?: RankingReuseActions }) {
  const theme = useTheme();
  const blurText = useBlur('offerHunter.productText');
  if (items.length === 0) {
    return <Typography variant="body2" color="text.secondary">{t.wizard.test.empty}</Typography>;
  }
  return (
    <Stack component="ol" aria-label={t.ranking.listLabel} spacing={1} sx={{ m: 0, p: 0, listStyle: 'none' }}>
      {items.map((item, i) => (
        <Box
          component="li"
          key={item.productId ?? item.goodsId ?? i}
          data-testid="ranking-item"
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'auto 1fr', sm: 'auto auto 1fr 140px' },
            alignItems: 'center',
            columnGap: 1.5,
            rowGap: 1,
            p: 1.25,
            borderRadius: 2,
            border: '1px solid',
            borderColor: item.chosen ? alpha(theme.palette.primary.main, 0.45) : 'divider',
            backgroundColor: item.chosen ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.1 : 0.05) : 'transparent',
          }}
        >
          <Typography
            variant="subtitle2"
            sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: item.chosen ? 'primary.main' : 'text.secondary', minWidth: 28, display: { xs: 'none', sm: 'block' } }}
          >
            {t.ranking.position(i + 1)}
          </Typography>
          <Box sx={{ position: 'relative' }}>
            <ProductThumb src={item.imageUrl} size={48} />
            {item.provider && <Box sx={{ position: 'absolute', right: -6, bottom: -6 }}><ProviderBadge provider={item.provider} size={20} /></Box>}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Blurred when={blurText} radius={5}>
              <Typography variant="body2" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                {item.title || t.ranking.noTitle}
              </Typography>
            </Blurred>
            <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mt: 0.25 }}>
              {item.priceCents != null && (
                <Blurred when={blurText} radius={5} inline>
                  <Typography component="span" variant="caption" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatCents(item.priceCents)}</Typography>
                </Blurred>
              )}
              {item.commissionPercent != null && (
                <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontVariantNumeric: 'tabular-nums' }}>
                  {`${commissionCopy(providerOf(item)).chip} `}
                  <Blurred when={blurText} radius={5} inline>{`${formatDecimal(item.commissionPercent)}%`}</Blurred>
                  {item.commissionEstimated && <EstimatedTag />}
                </Typography>
              )}
              <Chip
                size="small"
                variant={item.chosen ? 'filled' : 'outlined'}
                color={item.chosen ? 'primary' : 'default'}
                icon={item.chosen ? <AppIcon icon={Check} size="inline" /> : undefined}
                label={item.chosen ? t.wizard.test.chosen : t.wizard.test.notChosen}
                sx={{ height: 22, fontWeight: 600 }}
              />
              {reuse && <ReuseAction item={item} reuse={reuse} />}
            </Box>
          </Box>
          <Box sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}>
            <ScoreBar score={item.score} factors={item.factors} emphasis={item.chosen} />
          </Box>
          {item.aiReason && (
            <Box sx={{ gridColumn: '1 / -1', display: 'flex', gap: 0.75, color: 'text.secondary' }}>
              <Box component="span" sx={{ display: 'inline-flex', mt: '2px' }}><AppIcon icon={MessageSquareText} size="sm" /></Box>
              <Typography variant="caption" component="p">
                <Box component="span" sx={{ fontWeight: 600 }}>{`${t.wizard.test.aiReason}: `}</Box>
                <Blurred when={blurText} radius={5} inline>{item.aiReason}</Blurred>
              </Typography>
            </Box>
          )}
        </Box>
      ))}
    </Stack>
  );
}

const ru = t.rankingReuse;

function ReuseAction({ item, reuse }: { item: HuntRankingItem; reuse: RankingReuseActions }) {
  if (reuse.sentProductIds.has(item.productId)) {
    return (
      <Chip
        size="small"
        color="success"
        variant="outlined"
        icon={<AppIcon icon={CheckCheck} size="inline" />}
        label={ru.sent}
        data-testid="ranking-item-sent"
        sx={{ height: 22, fontWeight: 600 }}
      />
    );
  }
  if (item.chosen) return null;
  const busyHere = reuse.busyProductId === item.productId;
  return (
    <Tooltip title={reuse.reusable ? ru.sendTooltip : ru.expiredTooltip} arrow describeChild enterTouchDelay={0}>
      <span>{/* span: Tooltip segue funcionando com o botão desabilitado */}
        <Button
          size="small"
          variant="outlined"
          disabled={!reuse.reusable || reuse.busy}
          onClick={() => reuse.onSend(item)}
          aria-label={ru.sendAria(item.title || t.ranking.noTitle)}
          startIcon={busyHere ? <CircularProgress size={14} aria-hidden /> : <AppIcon icon={Send} size="inline" />}
          sx={{ height: 24, py: 0, fontWeight: 600 }}
        >
          {busyHere ? ru.sending : ru.send}
        </Button>
      </span>
    </Tooltip>
  );
}
