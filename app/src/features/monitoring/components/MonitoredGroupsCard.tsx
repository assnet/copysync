import { Box, Button, Chip, Stack, Tooltip, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Ear, Plus, Settings2 } from 'lucide-react';
import { AppIcon } from '@/components';
import { GroupAvatar } from '@/features/offers/components/GroupChip';
import { Blurred, useBlur } from '@/features/privacy';
import type { MonitoredGroupItem } from '@/types/api.types';
import { INNER_RADIUS, focusRingSx, iconTileSx, toneSurface } from '../monitoringStyle';
import { monitoringStrings } from '../strings';
import { GroupUsageChip } from './GroupUsageChip';
import { MonitorCard } from './MonitorCard';

const t = monitoringStrings.groups;

interface Props {
  groups: MonitoredGroupItem[];
  used: number;
  max: number | null;
  onConfigure: () => void;
}

/** Origem: grupos de concorrentes escutados nesta sessão, com as palavras-chave de cada um. */
export function MonitoredGroupsCard({ groups, used, max, onConfigure }: Props) {
  const theme = useTheme();
  const blurNames = useBlur('monitoring.groupNames');
  const blurKeywords = useBlur('monitoring.keywords');
  const empty = groups.length === 0;
  const neutral = toneSurface(theme, 'neutral');

  return (
    <MonitorCard
      icon={Ear}
      tone="info"
      title={t.monitoredTitle}
      subtitle={t.monitoredSubtitle}
      action={<GroupUsageChip used={used} max={max} />}
      footer={
        <Tooltip title={t.configureTooltip} arrow describeChild>
          <Button
            variant={empty ? 'contained' : 'outlined'}
            startIcon={<AppIcon icon={empty ? Plus : Settings2} size="sm" />}
            onClick={onConfigure}
          >
            {empty ? t.choose : t.edit}
          </Button>
        </Tooltip>
      }
    >
      {empty ? (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 1 }}>
          <Box aria-hidden sx={iconTileSx(theme, 'info')}><AppIcon icon={Ear} size="sm" /></Box>
          <Typography variant="body2" color="text.secondary">{t.monitoredEmpty}</Typography>
        </Stack>
      ) : (
        <Stack component="ul" spacing={0.5} sx={{ m: 0, p: 0, listStyle: 'none' }}>
          {groups.map((g) => {
            const title = g.title || t.untitled;
            return (
              <Box
                component="li"
                key={g.groupJid}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0, minHeight: 48, px: 1, py: 0.5,
                  borderRadius: INNER_RADIUS,
                  transition: theme.transitions.create('background-color', { duration: 200 }),
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <GroupAvatar title={blurNames ? null : g.title} avatarUrl={g.avatarUrl} size={32} blurFlag="monitoring.groupAvatars" />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Blurred when={blurNames} inline radius={5}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{title}</Typography>
                  </Blurred>
                </Box>
                {g.keywords.length === 0 ? (
                  <Chip size="small" label={t.keywordsAll} sx={{ ...neutral, border: 1, flexShrink: 0 }} />
                ) : (
                  <Tooltip
                    title={<Blurred when={blurKeywords} inline radius={5}>{t.keywordsTooltip(g.keywords.join(', '))}</Blurred>}
                    arrow
                    enterTouchDelay={0}
                    leaveTouchDelay={4000}
                  >
                    {/* Contagem (igual ao seletor): nunca corta a palavra; a lista fica no tooltip */}
                    <Chip
                      size="small"
                      variant="outlined"
                      tabIndex={0}
                      role="group"
                      aria-label={blurKeywords ? t.keywordsLabel(title) : `${t.keywordsLabel(title)}: ${g.keywords.join(', ')}`}
                      label={t.keywordsCount(g.keywords.length)}
                      sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums', ...focusRingSx(theme) }}
                    />
                  </Tooltip>
                )}
              </Box>
            );
          })}
        </Stack>
      )}
    </MonitorCard>
  );
}
