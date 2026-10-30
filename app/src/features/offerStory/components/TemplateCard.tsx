import { useState } from 'react';
import { Box, ButtonBase, IconButton, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import { Check, Star } from 'lucide-react';
import { AppIcon } from '@/components';
import { offerStoryStrings } from '../strings';
import { templateThumbnail, type OfferStoryTemplate } from '../types';

const t = offerStoryStrings.template;

interface Props {
  template: OfferStoryTemplate;
  selected: boolean;
  favorite: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
}

/** Card 9:16 do template com nome em legenda: clique seleciona (borda + check); estrela liga/desliga favorito. */
export function TemplateCard({ template, selected, favorite, onSelect, onToggleFavorite }: Props) {
  const theme = useTheme();
  const [broken, setBroken] = useState(false);
  const { primary } = theme.palette;

  return (
    <Box sx={{ position: 'relative' }}>
      <ButtonBase
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={template.name}
        focusRipple
        sx={{
          display: 'block', width: '100%', aspectRatio: '9 / 16', borderRadius: 3, overflow: 'hidden',
          border: '2px solid', borderColor: selected ? 'primary.main' : 'divider',
          bgcolor: 'action.hover',
          boxShadow: selected ? `0 0 0 3px ${alpha(primary.main, 0.25)}` : 'none',
          transition: theme.transitions.create(['border-color', 'box-shadow', 'transform'], { duration: 150 }),
          '&:hover': { borderColor: selected ? 'primary.main' : 'text.secondary', transform: 'translateY(-2px)' },
          '&.Mui-focusVisible': { outline: `2px solid ${primary.main}`, outlineOffset: 2 },
          '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
        }}
      >
        {broken ? (
          <Box sx={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', p: 1.5, background: `linear-gradient(160deg, ${alpha(primary.main, 0.35)}, ${alpha(theme.palette.secondary.main, 0.25)})` }}>
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
      {/* Legenda visível; o nome acessível já vem do aria-label do botão. */}
      <Typography aria-hidden variant="caption" color="text.secondary" noWrap title={template.name} sx={{ display: 'block', mt: 0.75, px: 0.25, fontWeight: 600 }}>
        {template.name}
      </Typography>

      {selected && (
        <Box
          aria-hidden
          sx={{
            position: 'absolute', top: 8, left: 8, width: 28, height: 28, borderRadius: '50%',
            display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: 'primary.contrastText',
            boxShadow: 2, pointerEvents: 'none',
          }}
        >
          <AppIcon icon={Check} size="sm" />
        </Box>
      )}

      <Tooltip title={favorite ? t.unfavorite : t.favorite} arrow>
        <IconButton
          size="small"
          onClick={onToggleFavorite}
          aria-pressed={favorite}
          aria-label={`${favorite ? t.unfavorite : t.favorite}: ${template.name}`}
          sx={{
            position: 'absolute', top: 6, right: 6, width: 36, height: 36,
            bgcolor: alpha(theme.palette.background.paper, 0.85), backdropFilter: 'blur(4px)',
            color: favorite ? 'warning.main' : 'text.secondary',
            '&:hover': { bgcolor: theme.palette.background.paper },
          }}
        >
          <AppIcon icon={Star} size="sm" fill={favorite ? 'currentColor' : 'none'} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
