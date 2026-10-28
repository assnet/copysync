import { useState } from 'react';
import { Alert, Box, Button, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { AppIcon, SectionCard } from '@/components';
import { GroupAvatar } from '@/features/offers/components/GroupChip';
import { Blurred, useBlur } from '@/features/privacy';
import type { BroadcastGroupItem } from '@/types/api.types';
import { monitoringStrings } from '../strings';
import { GroupUsageChip } from './GroupUsageChip';
import { uiErrorMessage } from '../utils/apiErrors';

const t = monitoringStrings.groups;

interface Props {
  /** Já na ordem de envio. */
  groups: BroadcastGroupItem[];
  used: number;
  max: number | null;
  /** Sessão do monitoramento: grupo de outra sessão ganha o chip "Envia por …". */
  monitorSessionId: string;
  sessionNameOf: (sessionId: string) => string | null;
  onAdd: () => void;
  /** Salva a nova ordem/lista (cada grupo com a sessão que envia); lança em erro. */
  onChange: (groups: { groupJid: string; sessionId: string }[]) => Promise<void>;
}

/** Grupos que recebem as ofertas, na ordem de envio; reordenar e remover salvam na hora. */
export function BroadcastGroupsCard({ groups, used, max, monitorSessionId, sessionNameOf, onAdd, onChange }: Props) {
  const blurNames = useBlur('monitoring.groupNames');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refs = groups.map((g) => ({ groupJid: g.groupJid, sessionId: g.sessionId }));

  const commit = async (next: { groupJid: string; sessionId: string }[]) => {
    setSaving(true);
    setError(null);
    try {
      await onChange(next);
    } catch (err) {
      setError(uiErrorMessage(err, { scope: 'groups' }));
    } finally {
      setSaving(false);
    }
  };

  const move = (index: number, delta: -1 | 1) => {
    const next = [...refs];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    void commit(next);
  };

  return (
    <SectionCard
      title={t.broadcastTitle}
      subtitle={t.broadcastSubtitle}
      action={<GroupUsageChip used={used} max={max} />}
      sx={{ height: '100%', display: 'flex', flexDirection: 'column', '& > .MuiCardContent-root': { flex: 1, display: 'flex', flexDirection: 'column' } }}
    >
      <Box sx={{ flex: 1 }}>
        {error && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>{error}</Alert>}
        {groups.length === 0 ? (
          <Typography variant="body2" color="text.secondary">{t.broadcastEmpty}</Typography>
        ) : (
          <Stack component="ol" spacing={0.5} sx={{ m: 0, p: 0, listStyle: 'none' }} aria-busy={saving}>
            {groups.map((g, i) => (
              <Box component="li" key={`${g.sessionId}:${g.groupJid}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                <Typography variant="caption" sx={{ fontWeight: 700, minWidth: 22, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                  {t.position(i + 1)}
                </Typography>
                <GroupAvatar title={g.title} avatarUrl={g.avatarUrl} size={28} blurFlag="monitoring.groupAvatars" />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Blurred when={blurNames} inline radius={5}>
                    <Typography variant="body2" noWrap>{g.title || t.untitled}</Typography>
                  </Blurred>
                  {g.sessionId !== monitorSessionId && (
                    <Tooltip title={t.otherSessionTooltip} arrow describeChild>
                      <Chip size="small" variant="outlined" color="primary" label={t.otherSession(sessionNameOf(g.sessionId) || t.untitled)} sx={{ height: 20, fontSize: 11, mt: 0.25 }} />
                    </Tooltip>
                  )}
                </Box>
                <Tooltip title={t.moveUp} arrow>
                  <span>
                    <IconButton size="small" aria-label={t.moveUp} disabled={saving || i === 0} onClick={() => move(i, -1)}>
                      <AppIcon icon={ArrowUp} size="sm" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={t.moveDown} arrow>
                  <span>
                    <IconButton size="small" aria-label={t.moveDown} disabled={saving || i === groups.length - 1} onClick={() => move(i, 1)}>
                      <AppIcon icon={ArrowDown} size="sm" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={t.remove} arrow>
                  <span>
                    <IconButton size="small" aria-label={t.remove} disabled={saving} onClick={() => void commit(refs.filter((r) => !(r.groupJid === g.groupJid && r.sessionId === g.sessionId)))}>
                      <AppIcon icon={X} size="sm" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            ))}
          </Stack>
        )}
      </Box>
      <Tooltip title={t.addTooltip} arrow describeChild>
        <Box component="span" sx={{ mt: 2, alignSelf: 'flex-start' }}>
          <Button variant="outlined" startIcon={<AppIcon icon={Plus} size="sm" />} onClick={onAdd} disabled={saving}>
            {t.add}
          </Button>
        </Box>
      </Tooltip>
    </SectionCard>
  );
}
