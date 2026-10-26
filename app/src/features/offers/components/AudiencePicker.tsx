import { Box, Card, CardActionArea, Typography } from '@mui/material';
import type { OfferAudience } from '@/types/api.types';
import { offerStrings } from '../strings';
import { OFFER_AUDIENCES } from '../utils/offerConfig';

interface Props {
  value: OfferAudience;
  onChange: (value: OfferAudience) => void;
  disabled?: boolean;
  /** Rótulo acessível do grupo de opções. */
  label: string;
}

/** Cartões de escolha única do público-alvo (emoji decorativo + nome + tom do texto). */
export function AudiencePicker({ value, onChange, disabled, label }: Props) {
  return (
    <Box
      role="radiogroup"
      aria-label={label}
      sx={{
        display: 'grid',
        gap: 1,
        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
      }}
    >
      {OFFER_AUDIENCES.map((key) => {
        const a = offerStrings.audiences[key];
        const selected = key === value;
        return (
          <Card
            key={key}
            variant="outlined"
            sx={{
              borderColor: selected ? 'primary.main' : 'divider',
              borderWidth: selected ? 2 : 1,
              bgcolor: selected ? 'action.selected' : 'background.paper',
              transition: 'border-color 150ms ease, background-color 150ms ease',
            }}
          >
            <CardActionArea
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(key)}
              sx={{ p: 1.25, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.25 }}
            >
              <Box component="span" aria-hidden sx={{ fontSize: 22, lineHeight: 1.2 }}>{a.emoji}</Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{a.label}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.3 }}>{a.subtitle}</Typography>
            </CardActionArea>
          </Card>
        );
      })}
    </Box>
  );
}
