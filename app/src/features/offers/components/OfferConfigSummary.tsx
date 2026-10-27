import { AvatarGroup, Box, Button, Card, Chip, Tooltip, Typography } from '@mui/material';
import { Pencil, Smartphone, TriangleAlert } from 'lucide-react';
import { AppIcon } from '@/components';
import type { OfferConfigGroup, OfferDispatchOrder, SessionItem } from '@/types/api.types';
import { offerStrings } from '../strings';
import { GroupAvatar } from './GroupChip';
import { Blurred, useBlur } from '@/features/privacy';

const t = offerStrings.summary;
const MAX_AVATARS = 5;
const MAX_NAMES = 3;

interface Props {
  /** Sessões da configuração ainda existentes, na ordem de envio. */
  sessions: SessionItem[];
  /** Sessões da configuração que foram apagadas. */
  missing: number;
  groups: OfferConfigGroup[];
  dispatchOrder?: OfferDispatchOrder;
  onEdit: () => void;
}

/**
 * Barra acima do gerador: por onde (sessões) e para quem (grupos) as ofertas saem.
 * Grupos como pilha de avatares + uma linha de nomes: cabe em qualquer largura sem empilhar chips.
 */
export function OfferConfigSummary({ sessions, missing, groups, dispatchOrder, onEdit }: Props) {
  const untitled = offerStrings.wizard.groups.untitled;
  const blurSession = useBlur('offers.sessionName');
  const blurNames = useBlur('offers.groupNames');
  const anyOffline = sessions.some((s) => s.status !== 'CONNECTED');
  const names = groups.slice(0, MAX_NAMES).map((g) => g.title || untitled);
  const restNames = groups.length - names.length;

  return (
    <Card
      variant="outlined"
      component="section"
      aria-label={t.label}
      sx={{ px: 2, py: 1.5, mb: 3, display: 'flex', flexDirection: 'column', gap: 1.25 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        {sessions.map((s) => {
          const offline = s.status !== 'CONNECTED';
          const chip = (
            <Chip
              size="small"
              icon={<AppIcon icon={offline ? TriangleAlert : Smartphone} size="sm" />}
              color={offline ? 'warning' : 'success'}
              variant="outlined"
              label={<Blurred when={blurSession} inline radius={5}>{t.session(s.name)}</Blurred>}
              tabIndex={offline ? 0 : undefined}
              sx={{ fontWeight: 600, maxWidth: 220 }}
            />
          );
          return offline ? <Tooltip key={s.id} title={t.sessionOfflineTooltip} arrow>{chip}</Tooltip> : <Box key={s.id}>{chip}</Box>;
        })}
        {(missing > 0 || sessions.length === 0) && (
          <Chip
            size="small"
            icon={<AppIcon icon={TriangleAlert} size="sm" />}
            color="warning"
            variant="outlined"
            label={sessions.length === 0 ? t.sessionMissing : t.sessionsRemoved(missing)}
            sx={{ fontWeight: 600 }}
          />
        )}
        {sessions.length > 1 && dispatchOrder && (
          <Chip size="small" variant="outlined" label={dispatchOrder === 'SEQUENTIAL' ? t.orderSequential : t.orderInterleaved} />
        )}
        {anyOffline && (
          <Typography variant="caption" color="warning.main" sx={{ fontWeight: 600 }}>{t.sessionOffline}</Typography>
        )}
        <Tooltip title={t.editTooltip} arrow>
          <Button size="small" variant="outlined" startIcon={<AppIcon icon={Pencil} size="sm" />} onClick={onEdit} sx={{ ml: 'auto' }}>
            {t.edit}
          </Button>
        </Tooltip>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
        <AvatarGroup
          max={MAX_AVATARS}
          spacing={4}
          sx={{ flexShrink: 0, '& .MuiAvatar-root': { width: 28, height: 28, fontSize: 11, borderColor: 'background.paper' } }}
        >
          {groups.map((g) => (
            <GroupAvatar key={g.conversationId} title={g.title} avatarUrl={g.avatarUrl} size={28} />
          ))}
        </AvatarGroup>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>{t.groups(groups.length)}</Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            component="p"
            title={blurNames ? undefined : groups.map((g) => g.title || untitled).join(', ')}
          >
            <Blurred when={blurNames} inline radius={4}>
              {names.join(', ')}{restNames > 0 ? ` ${t.andMore(restNames)}` : ''}
            </Blurred>
          </Typography>
        </Box>
      </Box>
    </Card>
  );
}
