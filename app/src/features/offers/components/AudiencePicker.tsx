import { Box, Card, CardActionArea, Tooltip, Typography } from '@mui/material';
import { AppIcon } from '@/components';
import type { OfferAudience } from '@/types/api.types';
import { offerStrings } from '../strings';
import { AUDIENCE_ICONS, OFFER_AUDIENCES } from '../utils/offerConfig';

interface Props {
  value: OfferAudience;
  onChange: (value: OfferAudience) => void;
  disabled?: boolean;
  /** Rótulo acessível do grupo de opções. */
  label: string;
}

/** Cartões de escolha única do público-alvo (ícone + nome na mesma linha, tom do texto abaixo). */
export function AudiencePicker({ value, onChange, disabled, label }: Props) {
  return (
    <Box
      role="radiogroup"
      aria-label={label}
      sx={{
        display: 'grid',
        gap: 1,
                // Colunas pela largura real do formulário (não pelo breakpoint da janela): a 1280 px o
        // formulário divide a tela e 4 colunas fixas cortavam "Beleza/Moda" e "Casa/Cozinha".
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 9.5rem), 1fr))',
      }}
    >
      {OFFER_AUDIENCES.map((key) => {
        const a = offerStrings.audiences[key];
        const selected = key === value;
        return (
          <Tooltip key={key} title={`${a.label}: ${a.subtitle}`} placement="top" enterDelay={400}>
          <Card
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
              sx={{ p: 1.25, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0.25, minWidth: 0 }}
            >
              <Typography
                variant="subtitle2"
                sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, color: selected ? 'primary.main' : 'text.primary' }}
              >
                <Box component="span" sx={{ display: 'inline-flex', flexShrink: 0 }}><AppIcon icon={AUDIENCE_ICONS[key]} /></Box>
                <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.label}</Box>
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.3, overflowWrap: 'anywhere' }}>{a.subtitle}</Typography>
            </CardActionArea>
          </Card>
          </Tooltip>
        );
      })}
    </Box>
  );
}
