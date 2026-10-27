import { Box, Button, Card, Chip, Tooltip, Typography } from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import PhoneIphoneOutlinedIcon from '@mui/icons-material/PhoneIphoneOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import type { OfferConfigGroup, SessionItem } from '@/types/api.types';
import { offerStrings } from '../strings';
import { GroupChip } from './GroupChip';

const t = offerStrings.summary;
const MAX_CHIPS = 4;

interface Props {
  session: SessionItem | null;
  groups: OfferConfigGroup[];
  onEdit: () => void;
}

/** Barra fina acima do gerador: por onde e para quem as ofertas saem. */
export function OfferConfigSummary({ session, groups, onEdit }: Props) {
  const offline = session != null && session.status !== 'CONNECTED';
  const shown = groups.slice(0, MAX_CHIPS);
  const rest = groups.length - shown.length;
  const untitled = offerStrings.wizard.groups.untitled;

  const sessionChip = (
    <Chip
      icon={offline || !session ? <WarningAmberOutlinedIcon /> : <PhoneIphoneOutlinedIcon />}
      color={offline || !session ? 'warning' : 'success'}
      variant="outlined"
      label={session ? t.session(session.name) : t.sessionMissing}
      tabIndex={offline ? 0 : undefined}
      sx={{ fontWeight: 600, maxWidth: 260 }}
    />
  );

  return (
    <Card
      variant="outlined"
      component="section"
      aria-label={t.label}
      sx={{ px: 2, py: 1.5, mb: 3, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}
    >
      {offline ? <Tooltip title={t.sessionOfflineTooltip} arrow>{sessionChip}</Tooltip> : sessionChip}
      {offline && (
        <Typography variant="caption" color="warning.main" sx={{ fontWeight: 600 }}>{t.sessionOffline}</Typography>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', minWidth: 0, flex: '1 1 240px' }}>
        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600, mr: 0.5 }}>{t.groups(groups.length)}</Typography>
        {shown.map((g) => (
          <GroupChip key={g.conversationId} title={g.title} avatarUrl={g.avatarUrl} untitled={untitled} sx={{ maxWidth: 200 }} />
        ))}
        {rest > 0 && (
          <Tooltip title={groups.slice(MAX_CHIPS).map((g) => g.title || untitled).join(', ')} arrow>
            <Chip size="small" variant="outlined" label={offerStrings.actions.moreGroups(rest)} tabIndex={0} />
          </Tooltip>
        )}
      </Box>

      <Tooltip title={t.editTooltip} arrow>
        <Button size="small" variant="outlined" startIcon={<EditOutlinedIcon />} onClick={onEdit} sx={{ ml: 'auto' }}>
          {t.edit}
        </Button>
      </Tooltip>
    </Card>
  );
}
