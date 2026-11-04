import {
  Box, Chip, Dialog, DialogContent, Divider, IconButton, Tooltip, Typography, alpha, useTheme,
} from '@mui/material';
import { X } from 'lucide-react';
import { AppIcon } from '@/components';
import type { SessionLimitsResponse } from '@/types/api.types';
import { sessionStrings } from '../strings';
import type { SessionChannel } from '../utils';
import { CHANNEL_ICON, channelLabel } from './SessionChannelChip';

const t = sessionStrings.picker;
const tc = sessionStrings.channel;

interface Props {
  open: boolean;
  onClose: () => void;
  limits: SessionLimitsResponse | null;
  onPick: (channel: SessionChannel) => void;
  /** Canal no limite do plano: abre o aviso de upgrade em vez do assistente. */
  onAtLimit: (channel: SessionChannel, limit: number) => void;
}

interface CardState {
  channel: SessionChannel;
  used: number;
  limit: number | null;
  unavailable: boolean;
}

/** Escolha do canal da nova sessão: um cartão por canal, com uso × limite e bloqueio por plano. */
export function ChannelPickerDialog({ open, onClose, limits, onPick, onAtLimit }: Props) {
  const theme = useTheme();
  const cards: CardState[] = [
    { channel: 'whatsapp', used: limits?.whatsapp.used ?? 0, limit: limits?.whatsapp.limit ?? null, unavailable: false },
    { channel: 'telegram', used: limits?.telegram.used ?? 0, limit: limits?.telegram.limit ?? null, unavailable: limits ? !limits.telegram.enabled : false },
  ];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, px: 3, pt: 2.5, pb: 1.5 }}>
        <Box>
          <Typography variant="h6" component="h1" fontWeight={700}>{t.title}</Typography>
          <Typography variant="body2" color="text.secondary">{t.subtitle}</Typography>
        </Box>
        <Tooltip title={t.close}>
          <IconButton onClick={onClose} aria-label={t.close}><AppIcon icon={X} size="lg" /></IconButton>
        </Tooltip>
      </Box>
      <Divider />
      <DialogContent sx={{ px: 3, py: 3 }}>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
          {cards.map(({ channel, used, limit, unavailable }) => {
            const name = channelLabel(channel);
            const atLimit = limit !== null && used >= limit;
            const disabled = unavailable || atLimit;
            const reason = unavailable ? t.unavailableTooltip : atLimit ? (limit === 0 ? t.notIncluded(name) : t.atLimit(name)) : '';
            const handle = () => {
              if (unavailable) return;
              if (atLimit) onAtLimit(channel, limit ?? 0);
              else onPick(channel);
            };
            return (
              <Tooltip key={channel} title={reason} disableHoverListener={!disabled} disableFocusListener={!disabled}>
                <Box
                  component="button"
                  type="button"
                  onClick={handle}
                  disabled={unavailable}
                  aria-disabled={disabled || undefined}
                  aria-label={name}
                  sx={{
                    all: 'unset', boxSizing: 'border-box', cursor: unavailable ? 'not-allowed' : 'pointer',
                    display: 'grid', gap: 1.25, p: 2.5, borderRadius: 3, textAlign: 'left',
                    border: '1.5px solid', borderColor: 'divider', bgcolor: 'background.paper',
                    opacity: disabled ? 0.6 : 1,
                    transition: 'border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease',
                    '&:hover:not([aria-disabled])': {
                      borderColor: alpha(theme.palette.primary.main, 0.5),
                      boxShadow: `0 6px 24px ${alpha(theme.palette.primary.main, 0.12)}`,
                      transform: 'translateY(-2px)',
                    },
                    '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
                    '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                    <Box
                      sx={{
                        width: 44, height: 44, borderRadius: 2.5, display: 'grid', placeItems: 'center',
                        bgcolor: alpha(theme.palette.primary.main, 0.1), color: 'primary.main',
                      }}
                    >
                      <AppIcon icon={CHANNEL_ICON[channel]} size="lg" />
                    </Box>
                    {unavailable ? (
                      <Chip size="small" label={t.unavailable} />
                    ) : (
                      <Chip
                        size="small"
                        variant="outlined"
                        color={atLimit ? 'warning' : 'default'}
                        label={tc.counter(used, limit)}
                        sx={{ fontVariantNumeric: 'tabular-nums' }}
                      />
                    )}
                  </Box>
                  <Typography variant="subtitle1" fontWeight={700}>{name}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {channel === 'whatsapp' ? tc.whatsappDescription : tc.telegramDescription}
                  </Typography>
                </Box>
              </Tooltip>
            );
          })}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
