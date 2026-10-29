import { Box, Button, Collapse, Stack, Typography, alpha } from '@mui/material';
import { Check, Crown } from 'lucide-react';
import { AppIcon } from '@/components';
import { PREMIUM_SLUG_OFFER } from '@/features/plans/catalog';
import { storefrontStrings } from '../strings';

const t = storefrontStrings.premium;

export interface PremiumSlugBannerProps {
  /** Nome digitado é especial (`PREMIUM`). Entra e sai com animação curta. */
  open: boolean;
  /** Link de compra; padrão `PREMIUM_SLUG_OFFER.checkoutUrl`. null = botão "Em breve" desabilitado. */
  checkoutUrl?: string | null;
}

/** Oferta do nome especial (só texto do catálogo; a compra é fora do painel). */
export function PremiumSlugBanner({ open, checkoutUrl = PREMIUM_SLUG_OFFER.checkoutUrl }: PremiumSlugBannerProps) {
  return (
    <Collapse in={open} unmountOnExit timeout={220}>
      <Box
        role="region"
        aria-label={t.title}
        sx={(theme) => ({
          mt: 1.5, p: 2, borderRadius: 2,
          border: `1px solid ${alpha(theme.palette.warning.main, 0.45)}`,
          bgcolor: alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.14 : 0.08),
        })}
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'warning.main', mb: 1 }}>
              <AppIcon icon={Crown} size="sm" />
              <Typography variant="subtitle2" color="text.primary" sx={{ fontWeight: 700 }}>{t.title}</Typography>
            </Stack>
            <Stack component="ul" spacing={0.5} sx={{ listStyle: 'none', p: 0, m: 0 }}>
              {t.benefits.map((b) => (
                <Stack component="li" key={b} direction="row" spacing={0.75} alignItems="center">
                  <Box sx={{ color: 'success.main', display: 'inline-flex' }}><AppIcon icon={Check} size="sm" /></Box>
                  <Typography variant="body2">{b}</Typography>
                </Stack>
              ))}
            </Stack>
          </Box>
          <Stack spacing={1} alignItems={{ xs: 'stretch', sm: 'flex-end' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{t.priceLabel}</Typography>
            {checkoutUrl ? (
              <Button variant="contained" color="warning" disableElevation href={checkoutUrl} target="_blank" rel="noopener noreferrer">
                {t.buy}
              </Button>
            ) : (
              <Button variant="contained" color="warning" disableElevation disabled>{t.soon}</Button>
            )}
          </Stack>
        </Stack>
      </Box>
    </Collapse>
  );
}
