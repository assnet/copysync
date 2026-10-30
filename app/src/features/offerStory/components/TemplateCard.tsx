import { useState } from 'react';
import { Box, ButtonBase, IconButton, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import { Check, Star } from 'lucide-react';
import { AppIcon } from '@/components';
import { offerStoryStrings } from '../strings';
import { REDUCED_MOTION, floatShadow, popIn, storyGradient } from '../storyStyle';
import { templateThumbnail, type OfferStoryTemplate } from '../types';

const t = offerStoryStrings.template;

interface Props {
  template: OfferStoryTemplate;
  selected: boolean;
  favorite: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
}

/**
 * Miniatura 9:16 sem moldura: cantos de 16px, sombra suave e elevação no hover.
 * Selecionado = anel de story em gradiente + selo de check. Estrela em pílula de vidro.
 */
export function TemplateCard({ template, selected, favorite, onSelect, onToggleFavorite }: Props) {
  const theme = useTheme();
  const [broken, setBroken] = useState(false);
  const { primary, secondary } = theme.palette;

  return (
    <Box sx={{ position: 'relative' }}>
      {/* Anel: o gradiente fica no wrapper; o padding vira a espessura do anel. */}
      <Box
        sx={{
          p: '6px', borderRadius: '22px',
          backgroundImage: selected ? storyGradient(theme) : 'none',
          boxShadow: selected ? `0 14px 32px -14px ${alpha(secondary.main, 0.9)}` : 'none',
          transition: theme.transitions.create(['transform'], { duration: 200 }),
          '&:hover': { transform: 'translateY(-4px)' },
          '&:has(.Mui-focusVisible)': { transform: 'translateY(-4px)' },
          [REDUCED_MOTION]: { transition: 'none', '&:hover': { transform: 'none' }, '&:has(.Mui-focusVisible)': { transform: 'none' } },
        }}
      >
        <ButtonBase
          onClick={onSelect}
          aria-pressed={selected}
          aria-label={template.name}
          focusRipple
          sx={{
            display: 'block', width: '100%', aspectRatio: '9 / 16', borderRadius: '16px', overflow: 'hidden',
            bgcolor: 'action.hover',
            // Selecionado: um filete da cor do fundo separa a arte do anel.
            outline: selected ? `2px solid ${theme.palette.background.paper}` : 'none',
            boxShadow: floatShadow(theme, selected),
            transition: theme.transitions.create(['box-shadow'], { duration: 200 }),
            '&:hover': { boxShadow: floatShadow(theme, true) },
            '& img': { transition: theme.transitions.create('transform', { duration: 350 }) },
            '&:hover img': { transform: 'scale(1.04)' },
            '&.Mui-focusVisible': { outline: `3px solid ${primary.main}`, outlineOffset: 3 },
            [REDUCED_MOTION]: { '& img': { transition: 'none' }, '&:hover img': { transform: 'none' } },
          }}
        >
          {broken ? (
            <Box sx={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', p: 1.5, background: `linear-gradient(160deg, ${alpha(primary.main, 0.35)}, ${alpha(secondary.main, 0.25)})` }}>
              <Typography variant="body2" sx={{ fontWeight: 700, textAlign: 'center' }}>{template.name}</Typography>
            </Box>
          ) : (
            <Box
              component="img"
              src={templateThumbnail(template.id)}
              alt=""
              loading="lazy"
              draggable={false}
              onError={() => setBroken(true)}
              sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          )}
        </ButtonBase>
      </Box>

      {/* Legenda visível; o nome acessível já vem do aria-label do botão. */}
      <Typography
        aria-hidden
        variant="body2"
        noWrap
        title={template.name}
        sx={{ display: 'block', mt: 1, px: 0.5, fontWeight: selected ? 700 : 600, fontSize: '0.8125rem', color: selected ? 'text.primary' : 'text.secondary' }}
      >
        {template.name}
      </Typography>

      {selected && (
        <Box
          aria-hidden
          sx={{
            position: 'absolute', top: 15, left: 15, width: 28, height: 28, borderRadius: '50%',
            display: 'grid', placeItems: 'center', color: primary.contrastText,
            backgroundImage: `linear-gradient(135deg, ${primary.main}, ${secondary.main})`,
            border: `2px solid ${theme.palette.common.white}`,
            boxShadow: `0 4px 12px -2px ${alpha(theme.palette.common.black, 0.5)}`, pointerEvents: 'none',
            animation: `${popIn} 260ms ease-out`,
            [REDUCED_MOTION]: { animation: 'none' },
          }}
        >
          <AppIcon icon={Check} size="sm" strokeWidth={3} />
        </Box>
      )}

      <Tooltip title={favorite ? t.unfavorite : t.favorite} arrow>
        <IconButton
          size="small"
          onClick={onToggleFavorite}
          aria-pressed={favorite}
          aria-label={`${favorite ? t.unfavorite : t.favorite}: ${template.name}`}
          sx={{
            position: 'absolute', top: 13, right: 13, width: 34, height: 34, borderRadius: '50%',
            // Vidro escuro nos dois modos: a estrela fica legível sobre qualquer arte.
            bgcolor: alpha(theme.palette.common.black, 0.38), backdropFilter: 'blur(8px)',
            border: `1px solid ${alpha(theme.palette.common.white, 0.22)}`,
            color: favorite ? 'warning.light' : theme.palette.common.white,
            '&:hover': { bgcolor: alpha(theme.palette.common.black, 0.55) },
            '&.Mui-focusVisible': { outline: `2px solid ${theme.palette.common.white}`, outlineOffset: 1 },
          }}
        >
          <AppIcon icon={Star} size="sm" fill={favorite ? 'currentColor' : 'none'} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
