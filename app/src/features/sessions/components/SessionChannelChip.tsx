import { Chip, useTheme } from '@mui/material';
import { AppIcon, TelegramIcon, WhatsAppIcon, brandColor } from '@/components';
import { sessionStrings } from '../strings';
import type { SessionChannel } from '../utils';

/** Logo de cada canal (único ponto: cartão, seletor, contadores). */
export const CHANNEL_ICON = { whatsapp: WhatsAppIcon, telegram: TelegramIcon } as const;

export const channelLabel = (channel: SessionChannel) => sessionStrings.channel[channel];

/** Chip "WhatsApp" / "Telegram" com o ícone do canal. */
export function SessionChannelChip({ channel }: { channel: SessionChannel }) {
  const { palette } = useTheme();
  return (
    <Chip
      size="small"
      variant="outlined"
      icon={<AppIcon icon={CHANNEL_ICON[channel]} size="sm" />}
      label={channelLabel(channel)}
      sx={{ '& .MuiChip-icon': { ml: 0.75, color: brandColor(channel, palette.mode) } }}
    />
  );
}
