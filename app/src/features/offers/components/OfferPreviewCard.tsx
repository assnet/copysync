import { useState } from 'react';
import { Box, Card, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import ImageNotSupportedOutlinedIcon from '@mui/icons-material/ImageNotSupportedOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { AffiliateProvider } from '@/types/api.types';
import { resolveMediaUrl } from '@/utils/resolveMediaUrl';
import { AFFILIATE_PROVIDERS } from '@/features/settings/affiliateProviders';
import { MarketplaceLogo } from '@/features/settings/components/MarketplaceLogo';
import { offerStrings } from '../strings';
import { discountPercent, formatCents } from '../utils/offerPrice';

const t = offerStrings.preview;

interface Props {
  provider: AffiliateProvider;
  imageUrl: string | null;
  title: string;
  priceCents: number | null;
  originalPriceCents: number | null;
  affiliateUrl: string;
}

/** Como a oferta vai aparecer: lê o rascunho, então reflete a edição antes de salvar. */
export function OfferPreviewCard({ provider, imageUrl, title, priceCents, originalPriceCents, affiliateUrl }: Props) {
  const [copied, setCopied] = useState(false);
  const spec = AFFILIATE_PROVIDERS.find((p) => p.provider === provider);
  const discount = discountPercent(priceCents, originalPriceCents);
  const src = resolveMediaUrl(imageUrl);
  const shownTitle = title.trim();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(affiliateUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sem permissão de área de transferência: o link continua visível para copiar à mão.
    }
  };

  return (
    <Card variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box
        sx={{
          position: 'relative',
          aspectRatio: '1 / 1',
          bgcolor: 'action.hover',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {src ? (
          <Box
            component="img"
            src={src}
            alt={t.imageAlt(shownTitle || t.noTitle)}
            loading="lazy"
            sx={{ width: '100%', height: '100%', objectFit: 'contain', bgcolor: 'common.white' }}
          />
        ) : (
          <Stack alignItems="center" spacing={1} sx={{ color: 'text.disabled' }}>
            <ImageNotSupportedOutlinedIcon sx={{ fontSize: 48 }} aria-hidden />
            <Typography variant="body2">{t.noImage}</Typography>
          </Stack>
        )}
        {discount != null && (
          <Chip
            label={t.discount(discount)}
            aria-label={t.discountAria(discount)}
            color="success"
            size="small"
            sx={{ position: 'absolute', top: 12, left: 12, fontWeight: 700 }}
          />
        )}
        {spec && (
          <Box sx={{ position: 'absolute', top: 12, right: 12, display: 'flex', alignItems: 'center', gap: 1 }}>
            <MarketplaceLogo src={spec.logo} size={32} />
          </Box>
        )}
      </Box>

      <Box sx={{ p: 2.5 }}>
        {spec && (
          <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {spec.name}
          </Typography>
        )}
        <Typography
          variant="subtitle1"
          sx={{
            fontWeight: 600,
            mt: 0.5,
            color: shownTitle ? 'text.primary' : 'text.disabled',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {shownTitle || t.noTitle}
        </Typography>

        <Box sx={{ mt: 1.5 }}>
          {originalPriceCents != null && discount != null && (
            <Typography variant="body2" color="text.secondary" sx={{ textDecoration: 'line-through' }}>
              {t.from(formatCents(originalPriceCents))}
            </Typography>
          )}
          {priceCents != null ? (
            <Typography variant="h5" sx={{ fontWeight: 700, color: 'success.main' }}>
              {t.to(formatCents(priceCents))}
            </Typography>
          ) : (
            <Typography variant="body2" color="text.disabled">{t.noPrice}</Typography>
          )}
        </Box>

        <Box
          sx={{
            mt: 2,
            pl: 1.5,
            pr: 0.5,
            py: 0.5,
            borderRadius: 1.5,
            border: 1,
            borderColor: 'divider',
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
          }}
        >
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography variant="caption" color="text.secondary" component="div">{t.affiliateLink}</Typography>
            <Typography variant="body2" noWrap title={affiliateUrl} sx={{ fontFamily: 'monospace' }}>
              {affiliateUrl}
            </Typography>
          </Box>
          <Tooltip title={copied ? t.linkCopied : t.copyLink}>
            <IconButton size="small" aria-label={t.copyLink} onClick={() => void copy()}>
              {copied ? <CheckIcon fontSize="small" color="success" /> : <ContentCopyIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Tooltip title={t.openLink}>
            <IconButton
              size="small"
              aria-label={t.openLink}
              component="a"
              href={affiliateUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
    </Card>
  );
}
