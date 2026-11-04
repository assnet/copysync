import {
  Box, Chip, Dialog, DialogContent, IconButton, LinearProgress, Tooltip, Typography, alpha, useMediaQuery, useTheme,
} from '@mui/material';
import { ArrowRight, Lock, X } from 'lucide-react';
import { AppIcon } from '@/components';
import type { SessionLimitsResponse } from '@/types/api.types';
import { sessionStrings } from '../strings';
import type { SessionChannel } from '../utils';
import { REDUCED_MOTION, brand, brandWash, focusRing } from '../sessionWizardStyle';
import { CHANNEL_ICON, channelLabel } from './SessionChannelChip';

const t = sessionStrings.picker;
const tc = sessionStrings.channel;

/** Texto só para leitor de tela (uso × limite do plano). */
const visuallyHidden = {
  position: 'absolute', width: 1, height: 1, m: -1, p: 0, overflow: 'hidden',
  clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
} as const;

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
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const cards: CardState[] = [
    { channel: 'whatsapp', used: limits?.whatsapp.used ?? 0, limit: limits?.whatsapp.limit ?? null, unavailable: false },
    { channel: 'telegram', used: limits?.telegram.used ?? 0, limit: limits?.telegram.limit ?? null, unavailable: limits ? !limits.telegram.enabled : false },
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      fullScreen={fullScreen}
      aria-labelledby="channel-picker-title"
      PaperProps={{ sx: { borderRadius: { xs: 0, sm: '20px' }, overflow: 'hidden' } }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, px: 3, pt: 2.5, pb: 1 }}>
        <Box>
          <Typography id="channel-picker-title" variant="h6" component="h1" fontWeight={700}>{t.title}</Typography>
          <Typography variant="body2" color="text.secondary">{t.subtitle}</Typography>
        </Box>
        <Tooltip title={t.close}>
          <IconButton onClick={onClose} aria-label={t.close} sx={{ width: 44, height: 44, mt: -0.5, mr: -1 }}>
            <AppIcon icon={X} size="lg" />
          </IconButton>
        </Tooltip>
      </Box>
      <DialogContent sx={{ px: 3, pt: 2, pb: 3 }}>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
          {cards.map(({ channel, used, limit, unavailable }) => {
            const name = channelLabel(channel);
            const color = brand(theme, channel);
            const atLimit = limit !== null && used >= limit;
            const blocked = unavailable || atLimit;
            const reason = unavailable ? t.unavailableTooltip : atLimit ? (limit === 0 ? t.notIncluded(name) : t.atLimit(name)) : '';
            const descId = `channel-picker-${channel}-desc`;
            const usageId = `channel-picker-${channel}-usage`;
            const usageText = unavailable ? `${t.unavailable}. ${t.unavailableTooltip}`
              : limit === null ? tc.counterTooltip(name, used, null)
                : atLimit ? `${tc.usageAria(name, used, limit)}. ${reason}` : tc.usageAria(name, used, limit);
            const handle = () => {
              if (unavailable) return;
              if (atLimit) onAtLimit(channel, limit ?? 0);
              else onPick(channel);
            };
            return (
              <Tooltip key={channel} title={reason} disableHoverListener={!blocked} disableFocusListener={!blocked}>
                <Box
                  component="button"
                  type="button"
                  onClick={handle}
                  data-unavailable={unavailable || undefined}
                  aria-disabled={blocked || undefined}
                  aria-label={name}
                  aria-describedby={`${descId} ${usageId}`}
                  sx={{
                    all: 'unset', boxSizing: 'border-box', position: 'relative', overflow: 'hidden',
                    cursor: unavailable ? 'not-allowed' : 'pointer',
                    display: 'flex', flexDirection: 'column', gap: 1.5, p: 2.5, minHeight: 44,
                    borderRadius: '18px', textAlign: 'left',
                    border: '1.5px solid', borderColor: 'divider', bgcolor: 'background.paper',
                    backgroundImage: blocked ? 'none' : brandWash(theme, channel, 0.6),
                    transition: 'border-color .2s ease, box-shadow .2s ease, transform .2s ease',
                    '&:hover:not([data-unavailable]), &:focus-visible:not([data-unavailable])': {
                      borderColor: alpha(color, 0.55),
                      boxShadow: `0 10px 28px -12px ${alpha(color, 0.45)}`,
                      transform: 'translateY(-2px)',
                    },
                    '&:focus-visible': focusRing(theme, channel),
                    [REDUCED_MOTION]: {
                      transition: 'none',
                      '&:hover:not([data-unavailable]), &:focus-visible:not([data-unavailable])': { transform: 'none' },
                    },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                    <Box
                      sx={{
                        width: 52, height: 52, borderRadius: '14px', display: 'grid', placeItems: 'center', flexShrink: 0,
                        bgcolor: blocked ? 'action.hover' : alpha(color, 0.14),
                        color: blocked ? 'text.disabled' : color,
                        filter: blocked ? 'grayscale(1)' : 'none',
                      }}
                    >
                      <AppIcon icon={CHANNEL_ICON[channel]} size="lg" />
                    </Box>
                    {unavailable ? (
                      <Box aria-hidden sx={{ color: 'text.disabled', display: 'flex', pt: 0.5 }}>
                        <AppIcon icon={Lock} size="md" />
                      </Box>
                    ) : atLimit ? (
                      <Chip
                        size="small"
                        color="warning"
                        variant="outlined"
                        icon={<AppIcon icon={Lock} size="sm" />}
                        label={t.seePlans}
                        sx={{ '& .MuiChip-icon': { ml: 0.75 }, pointerEvents: 'none' }}
                      />
                    ) : (
                      <Box sx={{ color: 'text.secondary', display: 'flex', pt: 0.5 }}>
                        <AppIcon icon={ArrowRight} size="md" aria-hidden />
                      </Box>
                    )}
                  </Box>

                  <Box>
                    <Typography variant="subtitle1" fontWeight={700} color={blocked ? 'text.secondary' : 'text.primary'}>
                      {name}
                    </Typography>
                    <Typography id={descId} variant="body2" color="text.secondary">
                      {channel === 'whatsapp' ? tc.whatsappDescription : tc.telegramDescription}
                    </Typography>
                  </Box>

                  <Box component="span" id={usageId} sx={visuallyHidden}>{usageText}</Box>
                  {unavailable ? (
                    <Chip
                      aria-hidden
                      size="small"
                      label={t.unavailable}
                      sx={{ mt: 'auto', alignSelf: 'flex-start', maxWidth: '100%' }}
                    />
                  ) : (
                    <Box aria-hidden sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mt: 'auto' }}>
                      <Chip
                        size="small"
                        variant="outlined"
                        color={atLimit ? 'warning' : 'default'}
                        label={tc.counter(used, limit)}
                        sx={{ fontVariantNumeric: 'tabular-nums', bgcolor: 'background.paper' }}
                      />
                      {limit !== null && limit > 0 && (
                        <LinearProgress
                          variant="determinate"
                          value={Math.min(100, (used / limit) * 100)}
                          sx={{
                            flex: 1, height: 4, borderRadius: 2,
                            bgcolor: alpha(theme.palette.text.primary, 0.08),
                            '& .MuiLinearProgress-bar': {
                              borderRadius: 2,
                              bgcolor: atLimit ? 'warning.main' : color,
                            },
                          }}
                        />
                      )}
                    </Box>
                  )}
                </Box>
              </Tooltip>
            );
          })}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
