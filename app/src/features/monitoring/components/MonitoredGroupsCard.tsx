import { Box, Button, Chip, Stack, Tooltip, Typography } from '@mui/material';
import { Settings2 } from 'lucide-react';
import { AppIcon, SectionCard } from '@/components';
import { GroupChip } from '@/features/offers/components/GroupChip';
import type { MonitoredGroupItem } from '@/types/api.types';
import { monitoringStrings } from '../strings';
import { GroupUsageChip } from './GroupUsageChip';

const t = monitoringStrings.groups;

interface Props {
  groups: MonitoredGroupItem[];
  used: number;
  max: number | null;
  onConfigure: () => void;
}

/** Grupos de concorrentes escutados nesta sessão, com as palavras-chave de cada um. */
export function MonitoredGroupsCard({ groups, used, max, onConfigure }: Props) {
  return (
    <SectionCard
      title={t.monitoredTitle}
      subtitle={t.monitoredSubtitle}
      action={<GroupUsageChip used={used} max={max} />}
      sx={{ height: '100%', display: 'flex', flexDirection: 'column', '& > .MuiCardContent-root': { flex: 1, display: 'flex', flexDirection: 'column' } }}
    >
      <Box sx={{ flex: 1 }}>
        {groups.length === 0 ? (
          <Typography variant="body2" color="text.secondary">{t.monitoredEmpty}</Typography>
        ) : (
          <Stack spacing={1}>
            {groups.map((g) => (
              <Box key={g.groupJid} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                <GroupChip
                  title={g.title}
                  avatarUrl={g.avatarUrl}
                  untitled={t.untitled}
                  nameFlag="monitoring.groupNames"
                  avatarFlag="monitoring.groupAvatars"
                  sx={{ maxWidth: '65%' }}
                />
                {g.keywords.length === 0 ? (
                  <Typography variant="caption" color="text.secondary" noWrap>{t.keywordsAll}</Typography>
                ) : (
                  <Tooltip title={t.keywordsTooltip(g.keywords.join(', '))} arrow>
                    <Chip size="small" variant="outlined" label={t.keywordsCount(g.keywords.length)} />
                  </Tooltip>
                )}
              </Box>
            ))}
          </Stack>
        )}
      </Box>
      <Tooltip title={t.configureTooltip} arrow describeChild>
        <Button variant="outlined" startIcon={<AppIcon icon={Settings2} size="sm" />} onClick={onConfigure} sx={{ mt: 2, alignSelf: 'flex-start' }}>
          {t.configure}
        </Button>
      </Tooltip>
    </SectionCard>
  );
}
