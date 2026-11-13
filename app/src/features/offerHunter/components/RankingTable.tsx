import { Box, Chip, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Check, MessageSquareText } from 'lucide-react';
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

/**
 * Ranking de uma busca, na ordem da pontuação: posição, foto, título, preço, pontuação (fatores no
 * Tooltip), se entrou no corte e o motivo da IA. Lista em vez de `<table>`: cabe no celular sem rolagem lateral.
 */
export function RankingTable({ items }: { items: HuntRankingItem[] }) {
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
