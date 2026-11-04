import { Box, Tooltip, useTheme } from '@mui/material';
import { AppIcon, brandColor } from '@/components';
import type { SessionChannel } from '../utils';
import { CHANNEL_ICON, channelLabel } from './SessionChannelChip';

interface Props {
  channel: SessionChannel;
  /** Token do `AppIcon`: `inline` ao lado de texto; `sm`/`md` isolado. */
  size?: 'inline' | 'sm' | 'md';
  /**
   * Logo isolado (sem o nome do canal ao lado): ganha tooltip e nome acessível. Ao lado de um
   * texto que já diz o canal, fica decorativo (`aria-hidden`).
   */
  labelled?: boolean;
}

/** Logo do canal (WhatsApp/Telegram) na cor da marca, legível no claro e no escuro. */
export function ChannelLogo({ channel, size = 'inline', labelled = false }: Props) {
  const { palette } = useTheme();
  const logo = (
    <Box
      component="span"
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? channelLabel(channel) : undefined}
      aria-hidden={labelled ? undefined : true}
      sx={{ display: 'inline-flex', flexShrink: 0, color: brandColor(channel, palette.mode), verticalAlign: 'middle' }}
    >
      <AppIcon icon={CHANNEL_ICON[channel]} size={size} />
    </Box>
  );
  return labelled ? <Tooltip title={channelLabel(channel)} arrow>{logo}</Tooltip> : logo;
}
