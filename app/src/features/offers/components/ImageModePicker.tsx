import { useId } from 'react';
import { Box, IconButton, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { Info } from 'lucide-react';
import { AppIcon } from '@/components';
import type { OfferImageMode } from '@/types/api.types';
import { offerStrings } from '../strings';
import { IMAGE_MODE_ICONS, OFFER_IMAGE_MODES } from '../utils/offerConfig';

const t = offerStrings.imageMode;

interface Props {
  value: OfferImageMode;
  onChange: (value: OfferImageMode) => void;
  disabled?: boolean;
}

/**
 * "Formato da imagem": foto com legenda × prévia do link. Dois modos nomeados de escolha única
 * (`ToggleButtonGroup` exclusivo; liga/desliga não serve). Usado no gerador e no monitoramento.
 */
export function ImageModePicker({ value, onChange, disabled }: Props) {
  const labelId = useId();
  const hintId = useId();
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.75 }}>
        <Typography id={labelId} variant="subtitle2" component="span" sx={{ fontWeight: 600 }}>{t.label}</Typography>
        <Tooltip title={t.help} arrow enterTouchDelay={0} leaveTouchDelay={5000}>
          <IconButton size="small" aria-label={t.infoAria} sx={{ width: 32, height: 32, color: 'text.secondary' }}>
            <AppIcon icon={Info} size="sm" />
          </IconButton>
        </Tooltip>
      </Box>
      <ToggleButtonGroup
        exclusive
        fullWidth
        size="small"
        color="primary"
        value={value}
        disabled={disabled}
        onChange={(_, next: OfferImageMode | null) => { if (next && next !== value) onChange(next); }}
        aria-labelledby={labelId}
        aria-describedby={hintId}
        sx={{ '& .MuiToggleButton-root': { textTransform: 'none', gap: 0.75, fontWeight: 600, py: 0.75 } }}
      >
        {OFFER_IMAGE_MODES.map((mode) => (
          <ToggleButton key={mode} value={mode}>
            <AppIcon icon={IMAGE_MODE_ICONS[mode]} />
            {t.options[mode].label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Typography id={hintId} variant="caption" color="text.secondary" component="p" sx={{ mt: 0.75, lineHeight: 1.4 }}>
        {t.options[value].hint}
      </Typography>
    </Box>
  );
}
