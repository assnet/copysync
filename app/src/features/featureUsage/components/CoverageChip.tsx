import { Box, Chip, Tooltip, Typography } from '@mui/material';
import { CircleAlert } from 'lucide-react';
import { AppIcon } from '@/components';
import { coverageTexts, featureDataSince, featureLabel } from '../rules';
import { featureUsageStrings as S } from '../strings';
import type { UsageFeatureItem } from '../types';

type CoverageFeature = Pick<UsageFeatureItem, 'key' | 'coverage' | 'coverageReasons' | 'retentionDays' | 'firstDataDay'>;

/**
 * Aviso de contagem parcial: um texto por código de `coverageReasons` no `Tooltip` (abre no foco e no toque) e o
 * "dados desde" do recurso (`firstDataDay`, nunca `dataFrom`). Sem motivo, não renderiza.
 */
export function CoverageChip({ feature }: { feature: CoverageFeature }) {
  const texts = coverageTexts(feature);
  if (feature.coverage !== 'PARTIAL' && texts.length === 0) return null;
  const title = (
    <Box sx={{ py: 0.25 }}>
      <Typography variant="caption" component="p" sx={{ fontWeight: 700 }}>{S.coverage.title}</Typography>
      {texts.map((text) => (
        <Typography key={text} variant="caption" component="p" sx={{ mt: 0.5 }}>{text}</Typography>
      ))}
      <Typography variant="caption" component="p" sx={{ mt: 0.5, opacity: 0.85 }}>{featureDataSince(feature)}</Typography>
    </Box>
  );
  return (
    <Tooltip title={title} arrow enterTouchDelay={0} leaveTouchDelay={6000}>
      <Chip
        size="small"
        variant="outlined"
        tabIndex={0}
        icon={<AppIcon icon={CircleAlert} size="sm" aria-hidden />}
        label={S.coverage.partial}
        aria-label={S.coverage.partialAria(featureLabel(feature.key))}
        sx={{
          height: 20,
          flexShrink: 0,
          // Ícone no tom de aviso (o texto fica no padrão: o âmbar do tema não tem contraste de texto no claro).
          '& .MuiChip-icon': { color: (t) => (t.palette.mode === 'light' ? t.palette.warning.dark : t.palette.warning.main) },
          '& .MuiChip-label': { px: 0.75, fontSize: 11, fontWeight: 600 },
        }}
      />
    </Tooltip>
  );
}
