import { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, IconButton, Snackbar, Stack, Tooltip, Typography, useMediaQuery } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { ArrowDown, ArrowUp, Plus, Send, X } from 'lucide-react';
import { AppIcon } from '@/components';
import { GroupAvatar } from '@/features/offers/components/GroupChip';
import { Blurred, useBlur } from '@/features/privacy';
import type { BroadcastGroupItem } from '@/types/api.types';
import { INNER_RADIUS, REDUCED_MOTION, REDUCED_MOTION_QUERY, VISUALLY_HIDDEN, iconTileSx, toneSurface } from '../monitoringStyle';
import { monitoringStrings } from '../strings';
import { GroupUsageChip } from './GroupUsageChip';
import { MonitorCard } from './MonitorCard';
import { uiErrorMessage } from '../utils/apiErrors';

const t = monitoringStrings.groups;
/** Tempo para desfazer a remoção de um grupo. */
const UNDO_MS = 6000;

type GroupRef = { groupJid: string; sessionId: string };
/** Remoção desfazível: o grupo, onde estava e as listas antes/depois (assinaturas) para saber se ainda vale. */
interface PendingUndo { group: GroupRef; index: number; before: string; after: string }

const sameRef = (a: GroupRef, b: GroupRef) => a.groupJid === b.groupJid && a.sessionId === b.sessionId;
const signature = (refs: readonly GroupRef[]) => refs.map((r) => `${r.sessionId}:${r.groupJid}`).join('|');

/** Devolve `group` à lista ATUAL na posição salva (limitada ao tamanho); não duplica. */
export function reinsertGroup(current: readonly GroupRef[], group: GroupRef, index: number): GroupRef[] {
  const next = current.filter((r) => !sameRef(r, group));
  next.splice(Math.max(0, Math.min(index, next.length)), 0, group);
  return next;
}

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
  onChange: (groups: GroupRef[]) => Promise<void>;
}

/** Destino: grupos que recebem as ofertas, na ordem de envio; reordenar e remover salvam na hora. */
export function BroadcastGroupsCard({ groups, used, max, monitorSessionId, sessionNameOf, onAdd, onChange }: Props) {
  const theme = useTheme();
  const blurNames = useBlur('monitoring.groupNames');
  const blurSession = useBlur('monitoring.sessionName');
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Anúncio para leitor de tela e remoção a desfazer: efêmeros, não são estado de trabalho
  const [announce, setAnnounce] = useState('');
  const [undo, setUndo] = useState<PendingUndo | null>(null);
  const refs: GroupRef[] = groups.map((g) => ({ groupJid: g.groupJid, sessionId: g.sessionId }));
  const currentSig = signature(refs);

  // A lista mudou por outro caminho (salvar no seletor, outra aba, recarga): desfazer não vale mais
  useEffect(() => {
    if (undo && currentSig !== undo.after && currentSig !== undo.before) setUndo(null);
  }, [currentSig, undo]);
  const empty = groups.length === 0;
  const primaryTint = toneSurface(theme, 'primary');

  const commit = async (next: GroupRef[], done?: string): Promise<boolean> => {
    setSaving(true);
    setError(null);
    setAnnounce('');
    try {
      await onChange(next);
      if (done) setAnnounce(done);
      return true;
    } catch (err) {
      setError(uiErrorMessage(err, { scope: 'groups' }));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const move = (index: number, delta: -1 | 1) => {
    setUndo(null);
    const next = [...refs];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    void commit(next, t.orderSaved);
  };

  const remove = async (item: GroupRef) => {
    setUndo(null);
    const g: GroupRef = { groupJid: item.groupJid, sessionId: item.sessionId };
    const index = refs.findIndex((r) => sameRef(r, g));
    const next = refs.filter((r) => !sameRef(r, g));
    // Remoção é anunciada só pelo Snackbar (que já tem o "Desfazer")
    if (await commit(next)) setUndo({ group: g, index, before: currentSig, after: signature(next) });
  };

  const restore = () => {
    const pending = undo;
    setUndo(null);
    if (pending) void commit(reinsertGroup(refs, pending.group, pending.index), t.listSaved);
  };

  const add = () => {
    setUndo(null);
    onAdd();
  };

  return (
    <MonitorCard
      icon={Send}
      tone="success"
      title={t.broadcastTitle}
      subtitle={t.broadcastSubtitle}
      action={<GroupUsageChip used={used} max={max} />}
      footer={
        <Tooltip title={t.addTooltip} arrow describeChild>
          <Box component="span">
            <Button
              variant={empty ? 'contained' : 'outlined'}
              startIcon={<AppIcon icon={Plus} size="sm" />}
              onClick={add}
              disabled={saving}
            >
              {empty ? t.choose : t.add}
            </Button>
          </Box>
        </Tooltip>
      }
    >
      <Box role="status" aria-live="polite" sx={VISUALLY_HIDDEN}>{announce}</Box>
      {error && <Alert severity="error" sx={{ mb: 1.5, borderRadius: INNER_RADIUS }} onClose={() => setError(null)}>{error}</Alert>}
      {empty ? (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 1 }}>
          <Box aria-hidden sx={iconTileSx(theme, 'success')}><AppIcon icon={Send} size="sm" /></Box>
          <Typography variant="body2" color="text.secondary">{t.broadcastEmpty}</Typography>
        </Stack>
      ) : (
        <Stack component="ol" spacing={0.5} sx={{ m: 0, p: 0, listStyle: 'none' }} aria-busy={saving}>
          {groups.map((g, i) => {
            const title = g.title || t.untitled;
            const other = g.sessionId !== monitorSessionId;
            return (
              <Box
                component="li"
                key={`${g.sessionId}:${g.groupJid}`}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0, minHeight: 48, px: 1, py: 0.5,
                  borderRadius: INNER_RADIUS,
                  transition: theme.transitions.create('background-color', { duration: 200 }),
                  '&:hover': { bgcolor: 'action.hover' },
                  // Ações discretas no md+ com mouse; completas no hover/foco e sempre no toque
                  '& [data-row-actions]': {
                    opacity: { xs: 1, md: 0.55 },
                    transition: theme.transitions.create('opacity', { duration: 200 }),
                    [REDUCED_MOTION]: { transition: 'none' },
                    '@media (hover: none)': { opacity: 1 },
                  },
                  '&:hover [data-row-actions], &:focus-within [data-row-actions]': { opacity: 1 },
                }}
              >
                <Box
                  aria-hidden
                  sx={{
                    width: 24, height: 24, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
                    typography: 'caption', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                    color: primaryTint.color, bgcolor: primaryTint.backgroundColor,
                  }}
                >
                  {i + 1}
                </Box>
                <GroupAvatar title={blurNames ? null : g.title} avatarUrl={g.avatarUrl} size={32} blurFlag="monitoring.groupAvatars" />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Blurred when={blurNames} inline radius={5}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{title}</Typography>
                  </Blurred>
                  {other && (
                    <Tooltip title={t.otherSessionTooltip} arrow describeChild enterTouchDelay={0} leaveTouchDelay={4000}>
                      <Chip
                        size="small"
                        label={<Blurred when={blurSession} inline radius={5}>{t.otherSession(sessionNameOf(g.sessionId) || t.untitled)}</Blurred>}
                        sx={{
                          ...primaryTint, border: 1, mt: 0.25, maxWidth: '100%', height: 'auto', minHeight: 20,
                          '& .MuiChip-label': { typography: 'caption', fontWeight: 600, px: 1, overflow: 'hidden', textOverflow: 'ellipsis' },
                        }}
                      />
                    </Tooltip>
                  )}
                </Box>
                <Stack
                  data-row-actions
                  direction="row"
                  role="group"
                  aria-label={t.actionsLabel(title)}
                  sx={{
                    flexShrink: 0, borderRadius: 999, p: 0.25,
                    border: 1, borderColor: alpha(theme.palette.text.primary, 0.08),
                    '& .MuiIconButton-root': { width: 32, height: 32, '@media (hover: none)': { width: 40, height: 40 } },
                  }}
                >
                  <Tooltip title={t.moveUp} arrow>
                    <span>
                      <IconButton size="small" aria-label={t.moveUpAria(title)} disabled={saving || i === 0} onClick={() => move(i, -1)}>
                        <AppIcon icon={ArrowUp} size="sm" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={t.moveDown} arrow>
                    <span>
                      <IconButton size="small" aria-label={t.moveDownAria(title)} disabled={saving || i === groups.length - 1} onClick={() => move(i, 1)}>
                        <AppIcon icon={ArrowDown} size="sm" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={t.remove} arrow>
                    <span>
                      <IconButton size="small" aria-label={t.removeAria(title)} disabled={saving} onClick={() => void remove(g)}>
                        <AppIcon icon={X} size="sm" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>
              </Box>
            );
          })}
        </Stack>
      )}
      <Snackbar
        open={undo !== null}
        autoHideDuration={UNDO_MS}
        onClose={(_e, reason) => { if (reason !== 'clickaway') setUndo(null); }}
        message={t.removed}
        action={<Button color="inherit" size="small" onClick={restore} disabled={saving}>{t.undo}</Button>}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transitionDuration={reducedMotion ? 0 : undefined}
      />
    </MonitorCard>
  );
}
