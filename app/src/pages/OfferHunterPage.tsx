import { Box } from '@mui/material';
import { PageHeader } from '@/components';
import { offerHunterStrings as t } from '@/features/offerHunter/strings';

/**
 * Tela inicial do Caçador de Ofertas (`/offer-hunter`, sob `OfferHunterRoute`).
 * TODO(T13): uso do dia, grupo de destino, cartões das caçadas, alertas de pausa.
 * TODO(T14): assistente de 3 passos (`usePersistedState('offerHunter.wizard', …)`).
 * TODO(T16): aviso de risco e estados travados (`useHuntOptions().blockedBy`).
 */
export function OfferHunterPage() {
  return (
    <Box>
      <PageHeader title={t.page.title} subtitle={t.page.subtitle} />
    </Box>
  );
}
