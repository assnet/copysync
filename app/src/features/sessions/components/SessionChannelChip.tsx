import { Chip } from '@mui/material';
import { MessageCircle, Send } from 'lucide-react';
import { AppIcon } from '@/components';
import { sessionStrings } from '../strings';
import type { SessionChannel } from '../utils';

/** Ícone Lucide de cada canal (único ponto: cartão, seletor, contadores). */
export const CHANNEL_ICON = { whatsapp: MessageCircle, telegram: Send } as const;

export const channelLabel = (channel: SessionChannel) => sessionStrings.channel[channel];

/** Chip "WhatsApp" / "Telegram" com o ícone do canal. */
export function SessionChannelChip({ channel }: { channel: SessionChannel }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      icon={<AppIcon icon={CHANNEL_ICON[channel]} size="sm" />}
      label={channelLabel(channel)}
      sx={{ '& .MuiChip-icon': { ml: 0.75 } }}
    />
  );
}
