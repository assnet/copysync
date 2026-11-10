import type { ReactNode } from 'react';
import { Box, Card, Chip, Stack, Typography, alpha, type ChipProps } from '@mui/material';
import { AppIcon } from '@/components';
import { isMuiIcon, type AffiliateHighlightIcon, type AffiliateProviderSpec } from '../affiliateProviders';
import { MarketplaceLogo } from './MarketplaceLogo';

function HighlightIcon({ icon }: { icon: AffiliateHighlightIcon }) {
  if (isMuiIcon(icon)) {
    const Icon = icon;
    return <Icon sx={{ fontSize: 17 }} />;
  }
  return <AppIcon icon={icon} size="sm" />;
}

interface Props {
  spec: AffiliateProviderSpec;
  chip: ChipProps;
  /** Chip "vazio" (sem credencial) usa borda e texto neutros. */
  chipMuted?: boolean;
  /** Corpo do card abaixo dos destaques (estado, campos e ações). */
  children: ReactNode;
}

/**
 * Moldura comum dos cards de marketplace: faixa e fundo translúcido com a cor da marca, logo,
 * nome, chip de estado, descrição e os três destaques. Cabeçalho próprio (não `SectionCard`).
 */
/** Marca preta (Shein) some no tema escuro: a faixa e os fundos usam o texto do tema como acento. */
const DARK_ON_DARK = '#000000';

export function AffiliateCardShell({ spec, chip, chipMuted, children }: Props) {
  const brand = spec.brandColor;
  const isBlack = brand === DARK_ON_DARK;
  return (
    <Card
      component="article"
      aria-label={spec.name}
      sx={{
        height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden',
        // Faixa da marca no topo; o fundo translúcido some no escuro sem virar mancha.
        borderTop: (theme) => `3px solid ${isBlack && theme.palette.mode === 'dark' ? theme.palette.text.primary : brand}`,
        backgroundImage: `linear-gradient(180deg, ${alpha(brand, 0.07)} 0%, transparent 96px)`,
        transition: 'transform .2s ease, box-shadow .2s ease, border-color .2s ease',
        '&:hover': (theme) => ({
          transform: 'translateY(-2px)',
          boxShadow: theme.palette.mode === 'dark'
            ? `0 10px 28px ${alpha(theme.palette.common.black, 0.45)}`
            : `0 10px 28px ${alpha(theme.palette.text.primary, 0.08)}`,
        }),
        '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 2.5, pt: 2.25, pb: 2 }}>
        <MarketplaceLogo src={spec.logo} size={44} />
        {/* Chip abaixo do nome: ao lado, em 3 colunas, espremia o nome até sobrepor. */}
        <Stack spacing={0.5} alignItems="flex-start" sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" component="h2" sx={{ fontSize: '1.0625rem', lineHeight: 1.25 }}>
            {spec.name}
          </Typography>
          <Chip
            size="small"
            {...chip}
            sx={chipMuted
              ? { fontWeight: 600, height: 22, borderColor: 'divider', color: 'text.secondary' }
              : { fontWeight: 600, height: 22 }}
          />
        </Stack>
      </Stack>

      <Stack spacing={2} sx={{ px: 2.5, pb: 2.5, flexGrow: 1 }}>
        <Typography variant="body2" color="text.secondary">{spec.description}</Typography>

        <Stack component="ul" spacing={1.25} sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {spec.highlights.map(({ icon, text }) => (
            <Stack component="li" key={text} direction="row" spacing={1.25} alignItems="center">
              <Box
                aria-hidden
                sx={{
                  width: 30, height: 30, borderRadius: 1, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  // Marca preta (Shein) somaria a nada no escuro: o fundo cai para o neutro do tema.
                  bgcolor: (theme) => (theme.palette.mode === 'dark' && isBlack
                    ? 'action.selected'
                    : alpha(brand, 0.16)),
                  color: 'text.primary',
                }}
              >
                <HighlightIcon icon={icon} />
              </Box>
              <Typography variant="body2">{text}</Typography>
            </Stack>
          ))}
        </Stack>

        {children}
      </Stack>
    </Card>
  );
}
