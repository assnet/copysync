import { Box, Button } from '@mui/material';
import { ArrowLeft } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import { AppIcon, PageHeader } from '@/components';
import { offerHunterStrings as t } from '@/features/offerHunter/strings';

/**
 * Detalhe de uma caçada (`/offer-hunter/:huntId`, sob `OfferHunterRoute`).
 * TODO(T15): achados com aprovar/dispensar (`useHuntFinds`) e histórico (`useHuntRuns`), ambos por cursor.
 */
export function OfferHunterDetailPage() {
  return (
    <Box>
      <Button component={RouterLink} to="/offer-hunter" size="small" startIcon={<AppIcon icon={ArrowLeft} size="sm" />} sx={{ mb: 2 }}>
        {t.page.back}
      </Button>
      <PageHeader title={t.page.detailTitle} />
    </Box>
  );
}
