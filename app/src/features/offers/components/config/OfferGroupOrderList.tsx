import { forwardRef, useState } from 'react';
import { Box, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { ArrowDown, ArrowUp, Lock, X } from 'lucide-react';
import { AppIcon, OverflowTooltipText } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import type { SessionItem } from '@/types/api.types';
import { offerStrings } from '../../strings';
import { isUnpostable, postBlockedText } from '../../utils/postBlocked';
import { GroupAvatar } from '../GroupChip';
import type { SelectedGroup } from './ConfigGroupsStep';
import { sessionColor } from './DispatchOrderPicker';

const t = offerStrings.wizard.confirm.groupOrder;
const pb = offerStrings.postBlocked;
const untitled = offerStrings.wizard.groups.untitled;

const VISUALLY_HIDDEN = {
  position: 'absolute', width: '1px', height: '1px', p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
} as const;

interface Props {
  /** Na ordem de envio. */
  sessions: SessionItem[];
  /** Na ordem de envio (a ordem entre sessões vem da "Ordem de envio"). */
  groups: (SelectedGroup & { id: string })[];
  /** Troca o grupo de lugar com o vizinho da MESMA sessão. */
  onMove: (id: string, delta: -1 | 1) => void;
  onRemove: (id: string) => void;
}

/**
 * Grupos escolhidos na ordem de envio, com setas para reordenar e "x" para tirar (mesmo padrão dos
 * grupos de disparo do monitoramento). Com várias sessões, uma lista por sessão: a ordem vale dentro
 * dela. A ref aponta para a 1ª linha sem permissão de postar ("Revisar grupos").
 */
export const OfferGroupOrderList = forwardRef<HTMLLIElement, Props>(function OfferGroupOrderList({ sessions, groups, onMove, onRemove }, firstUnpostableRef) {
  const theme = useTheme();
  const blurNames = useBlur('offers.groupNames');
  const blurSession = useBlur('offers.sessionName');
  const [announce, setAnnounce] = useState('');
  const multi = sessions.length > 1;
  const firstUnpostable = groups.find(isUnpostable)?.id;

  const move = (list: typeof groups, i: number, delta: -1 | 1) => {
    const g = list[i]!;
    onMove(g.id, delta);
    setAnnounce(t.moved(g.title || untitled, i + 1 + delta));
  };

  const sections = sessions
    .map((s, si) => ({ session: s, color: sessionColor(si), items: groups.filter((g) => g.sessionId === s.id) }))
    .filter((sec) => sec.items.length > 0);

  return (
    <Box>
      <Box role="status" aria-live="polite" sx={VISUALLY_HIDDEN}>{announce}</Box>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
        {multi ? t.helpMulti : t.help}
      </Typography>
      <Stack spacing={1.5} sx={{ maxHeight: 440, overflowY: 'auto', pr: 0.5 }}>
        {sections.map(({ session, color, items }) => (
          <Box key={session.id}>
            {multi && (
              <Typography variant="caption" component="p" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontWeight: 600, mb: 0.5 }}>
                <Box component="span" aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
                <Blurred when={blurSession} inline radius={4}>{t.sessionList(session.name)}</Blurred>
              </Typography>
            )}
            <Stack component="ol" spacing={0.5} sx={{ m: 0, p: 0, listStyle: 'none' }} aria-label={multi ? t.sessionList(session.name) : t.listLabel}>
              {items.map((g, i) => {
                const title = g.title || untitled;
                const blocked = isUnpostable(g);
                const reason = blocked ? postBlockedText(g.postBlockedReason) : null;
                return (
                  <Box
                    component="li"
                    key={g.id}
                    ref={g.id === firstUnpostable ? firstUnpostableRef : undefined}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0, minHeight: 48, px: 1, py: 0.5,
                      borderRadius: 2, scrollMarginTop: 80,
                      border: 1, borderColor: blocked ? alpha(theme.palette.warning.main, 0.5) : 'transparent',
                      borderStyle: blocked ? 'dashed' : 'solid',
                      transition: theme.transitions.create('background-color', { duration: 200 }),
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    <Box
                      aria-hidden
                      sx={{
                        width: 24, height: 24, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
                        typography: 'caption', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                        color: 'primary.main', bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.2 : 0.1),
                      }}
                    >
                      {i + 1}
                    </Box>
                    <Box sx={{ display: 'flex', opacity: blocked ? 0.6 : 1 }}>
                      <GroupAvatar title={blurNames ? null : g.title} avatarUrl={g.avatarUrl} size={32} blurFlag="offers.groupAvatars" />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box component="span" sx={VISUALLY_HIDDEN}>{t.position(i + 1)}</Box>
                      <Blurred when={blurNames} inline radius={5}>
                        <OverflowTooltipText text={title} disabled={blurNames} typographyProps={{ variant: 'body2', sx: { fontWeight: 600 } }} />
                      </Blurred>
                      {reason && (
                        <Tooltip title={`${reason.long} ${pb.savedHint}`} arrow describeChild enterTouchDelay={0} leaveTouchDelay={4000}>
                          <Chip
                            size="small"
                            color="warning"
                            variant="outlined"
                            icon={<AppIcon icon={Lock} size="inline" />}
                            label={pb.savedChip}
                            aria-label={`${pb.savedChip}: ${reason.short}`}
                            tabIndex={0}
                            sx={{ mt: 0.25, height: 'auto', minHeight: 20, '& .MuiChip-label': { typography: 'caption', fontWeight: 600, px: 0.5 } }}
                          />
                        </Tooltip>
                      )}
                    </Box>
                    <Stack
                      direction="row"
                      role="group"
                      aria-label={t.actionsLabel(title)}
                      sx={{
                        flexShrink: 0, borderRadius: 999, p: 0.25, border: 1, borderColor: alpha(theme.palette.text.primary, 0.08),
                        '& .MuiIconButton-root': { width: 32, height: 32, '@media (hover: none)': { width: 40, height: 40 } },
                      }}
                    >
                      <Tooltip title={t.moveUp} arrow>
                        <span>
                          <IconButton size="small" aria-label={t.moveUpAria(title)} disabled={i === 0} onClick={() => move(items, i, -1)}>
                            <AppIcon icon={ArrowUp} size="sm" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={t.moveDown} arrow>
                        <span>
                          <IconButton size="small" aria-label={t.moveDownAria(title)} disabled={i === items.length - 1} onClick={() => move(items, i, 1)}>
                            <AppIcon icon={ArrowDown} size="sm" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={t.remove} arrow>
                        <span>
                          <IconButton size="small" data-remove aria-label={t.removeAria(title)} onClick={() => onRemove(g.id)}>
                            <AppIcon icon={X} size="sm" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  </Box>
                );
              })}
            </Stack>
          </Box>
        ))}
      </Stack>
    </Box>
  );
});
