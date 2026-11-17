import { Link as RouterLink } from 'react-router-dom';
import { Button, Stack, Typography } from '@mui/material';
import { ArrowLeft } from 'lucide-react';
import { AppIcon } from '@/components';
import { featureDescription, featureLabel } from '../rules';
import { featureUsageStrings as S } from '../strings';
import { USAGE_PATH } from '../paths';
import { useUsagePage } from '../hooks/useUsagePage';

/**
 * Detalhe de um recurso (`/admin/usage/features/:key`, aba Visão geral marcada). O recurso vem da URL e o dado do
 * servidor pela chave (sobrevive a reload). Medidas, série, por plano e a lista de contas entram aqui; o resumo da
 * página fica desligado enquanto o detalhe está aberto (uma leitura de uso por vez).
 */
export default function FeatureDetailTab() {
  const { featureKey } = useUsagePage();
  const key = featureKey ?? '';
  return (
    <Stack spacing={2} aria-label={S.detail.aria(featureLabel(key))} component="section">
      <div>
        <Button
          component={RouterLink}
          to={USAGE_PATH}
          startIcon={<AppIcon icon={ArrowLeft} size="sm" aria-hidden />}
          sx={{ minHeight: 44 }}
        >
          {S.actions.back}
        </Button>
      </div>
      <div>
        <Typography variant="h6" component="h2">{S.detail.title(featureLabel(key))}</Typography>
        {featureDescription(key) && (
          <Typography variant="body2" color="text.secondary">{featureDescription(key)}</Typography>
        )}
      </div>
    </Stack>
  );
}
