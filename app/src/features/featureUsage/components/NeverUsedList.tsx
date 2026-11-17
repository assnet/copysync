import { Link as RouterLink } from 'react-router-dom';
import { Box, Card, CardContent, Chip, Stack, Tooltip, Typography } from '@mui/material';
import { CircleCheck } from 'lucide-react';
import { AppIcon } from '@/components';
import { featureDescription, featureLabel, neverUsedFeatures } from '../rules';
import { featureUsageStrings as S } from '../strings';
import { usageFeaturePath } from '../paths';
import type { UsageFeatureItem } from '../types';

const n = S.neverUsed;

/**
 * Recursos do recorte que nenhuma conta usou no período (chips por nome; cada um abre o detalhe). Lista vazia é
 * boa notícia: mensagem positiva no lugar dos chips.
 */
export function NeverUsedList({ features }: { features: readonly UsageFeatureItem[] }) {
  const items = neverUsedFeatures(features);
  return (
    <Card component="section" aria-label={n.aria}>
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        <Typography variant="subtitle1" component="h3">{n.title}</Typography>
        <Typography variant="caption" color="text.secondary" component="p">{n.subtitle}</Typography>
        {items.length === 0 ? (
          <Stack direction="row" spacing={1} sx={{ mt: 1.5, alignItems: 'center', color: 'text.secondary' }}>
            <Box
              component="span"
              sx={{ display: 'inline-flex', color: (t) => (t.palette.mode === 'light' ? t.palette.success.dark : t.palette.success.main) }}
            >
              <AppIcon icon={CircleCheck} size="sm" aria-hidden />
            </Box>
            <Typography variant="body2">{n.empty}</Typography>
          </Stack>
        ) : (
          <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0, mt: 1.5, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {items.map((f) => (
              <li key={f.key}>
                <Tooltip title={featureDescription(f.key)} arrow enterTouchDelay={0}>
                  <Chip
                    component={RouterLink}
                    to={usageFeaturePath(f.key)}
                    clickable
                    variant="outlined"
                    label={featureLabel(f.key)}
                    aria-label={S.actions.openDetail(featureLabel(f.key))}
                    sx={{ minHeight: 32 }}
                  />
                </Tooltip>
              </li>
            ))}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
