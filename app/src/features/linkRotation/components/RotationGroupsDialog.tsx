import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton,
  InputAdornment, List, ListItemButton, ListItemIcon, ListItemText, Stack, TextField, Tooltip, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Info, Search, X } from 'lucide-react';
import { AppIcon } from '@/components';
import { GroupAvatar } from '@/features/offers/components/GroupChip';
import { Blurred, useBlur } from '@/features/privacy';
import { usePersistedState } from '@/hooks/usePersistedState';
import { linkRotationService } from '@/services/linkRotation.service';
import { linkRotationError, linkRotationErrorMessage } from '@/utils/linkRotationErrors';
import { linkRotationStrings } from '../strings';
import { ROTATION_RANGES, type Rotation, type RotationGroup, type RotationGroupCandidate, type RotationGroupCandidates, type SaveRotationGroupInput } from '../types';
import { PlanLimitBanner } from './PlanLimitBanner';
import { needsInviteField, RotationGroupItem, type RotationGroupDraft } from './RotationGroupItem';

const t = linkRotationStrings.groups;

export interface RotationGroupsDialogProps {
  /** Diálogo visível. */
  open: boolean;
  /** Fechar sem salvar. */
  onClose: () => void;
  /** Rodízio cujos grupos são editados (usa `sessionId`, `strategy` e `groups`). */
  rotation: Rotation;
  /** Máximo de grupos por rodízio no plano (`limits.linkRotationGroups`); `null` = ilimitado. */
  limit: number | null;
  /** Chamado com a lista salva (resposta do PUT `/:id/groups`). */
  onSaved: (groups: RotationGroup[]) => void;
}

interface Draft {
  search: string;
  items: RotationGroupDraft[];
}

/** Formato aceito pela API para convite colado à mão. */
export const INVITE_URL_PATTERN = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+\/?$/;

const normalize = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function draftFromRotation(rotation: Rotation): Draft {
  const items = [...rotation.groups]
    .sort((a, b) => a.position - b.position)
    .map<RotationGroupDraft>((g) => ({
      groupJid: g.groupJid,
      conversationId: g.conversationId,
      title: g.groupName,
      avatarUrl: null,
      capacity: g.capacity,
      weight: g.weight,
      linkSource: g.linkSource ?? 'AUTO',
      manualInviteUrl: g.linkSource === 'MANUAL' ? (g.inviteUrl ?? '') : '',
    }));
  return { search: '', items };
}

/**
 * Seleção e ajuste dos grupos do rodízio: busca, limite do plano (acima dele abre o aviso de
 * upgrade sem marcar), ordem, teto de membros, peso (só WEIGHTED) e link de convite AUTO/MANUAL.
 * Rascunho por rodízio em `usePersistedState` (aba); limpo ao salvar ou cancelar.
 */
export function RotationGroupsDialog({ open, onClose, rotation, limit, onSaved }: RotationGroupsDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const blurName = useBlur('linkRotation.groupName');
  const [draft, setDraft, clearDraft] = usePersistedState<Draft>(
    `linkRotation.groups.${rotation.id}`,
    () => draftFromRotation(rotation),
    { scope: 'tab', version: 1 },
  );
  const [candidates, setCandidates] = useState<RotationGroupCandidates | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshed, setRefreshed] = useState<Record<string, RotationGroup>>({});
  const [refreshing, setRefreshing] = useState<ReadonlySet<string>>(new Set());
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [bannerLimit, setBannerLimit] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setCandidates(await linkRotationService.listGroups(rotation.id));
    } catch (e) {
      setLoadError(linkRotationErrorMessage(e) === linkRotationStrings.errors.generic ? t.loadError : linkRotationErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [rotation.id]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const saved = useMemo(() => {
    const map = new Map<string, RotationGroup>();
    for (const g of rotation.groups) map.set(g.groupJid, refreshed[g.groupJid] ?? g);
    return map;
  }, [rotation.groups, refreshed]);

  const avatarByJid = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const c of candidates?.groups ?? []) map.set(c.groupJid, c.avatarUrl);
    return map;
  }, [candidates]);

  const selected = useMemo(() => new Set(draft.items.map((i) => i.groupJid)), [draft.items]);
  const total = candidates?.groups.length ?? draft.items.length;

  const filtered = useMemo(() => {
    const q = normalize(draft.search.trim());
    const list = candidates?.groups ?? [];
    return q ? list.filter((c) => normalize(c.title ?? '').includes(q)) : list;
  }, [candidates, draft.search]);

  const setItems = (fn: (items: RotationGroupDraft[]) => RotationGroupDraft[]) => setDraft((d) => ({ ...d, items: fn(d.items) }));

  const clearItemError = (jid: string) =>
    setItemErrors((prev) => {
      if (!(jid in prev)) return prev;
      const { [jid]: _gone, ...rest } = prev;
      return rest;
    });

  const toggle = (c: RotationGroupCandidate) => {
    if (selected.has(c.groupJid)) {
      setItems((items) => items.filter((i) => i.groupJid !== c.groupJid));
      clearItemError(c.groupJid);
      return;
    }
    if (limit !== null && draft.items.length >= limit) {
      setBannerLimit(limit);
      return;
    }
    setItems((items) => [
      ...items,
      {
        groupJid: c.groupJid,
        conversationId: c.conversationId,
        title: c.title,
        avatarUrl: c.avatarUrl,
        capacity: ROTATION_RANGES.capacity.default,
        weight: ROTATION_RANGES.weight.min,
        linkSource: 'AUTO',
        manualInviteUrl: '',
      },
    ]);
  };

  const move = (index: number, dir: -1 | 1) =>
    setItems((items) => {
      const to = index + dir;
      if (to < 0 || to >= items.length) return items;
      const next = [...items];
      [next[index], next[to]] = [next[to]!, next[index]!];
      return next;
    });

  const patch = (jid: string, p: Partial<RotationGroupDraft>) => {
    setItems((items) => items.map((i) => (i.groupJid === jid ? { ...i, ...p } : i)));
    if ('manualInviteUrl' in p || 'linkSource' in p) clearItemError(jid);
  };

  const refresh = async (jid: string) => {
    const group = saved.get(jid);
    if (!group) return;
    setRefreshing((s) => new Set(s).add(jid));
    clearItemError(jid);
    try {
      const fresh = await linkRotationService.refreshGroup(rotation.id, group.id);
      setRefreshed((r) => ({ ...r, [jid]: fresh }));
    } catch (e) {
      setItemErrors((prev) => ({ ...prev, [jid]: linkRotationErrorMessage(e) }));
    } finally {
      setRefreshing((s) => {
        const n = new Set(s);
        n.delete(jid);
        return n;
      });
    }
  };

  const cancel = () => {
    clearDraft();
    onClose();
  };

  const save = async () => {
    const errors: Record<string, string> = {};
    const payload: SaveRotationGroupInput[] = draft.items.map((item, position) => {
      const status = saved.get(item.groupJid)?.status ?? null;
      const url = item.manualInviteUrl.trim();
      const withField = needsInviteField(item, status);
      if (item.linkSource === 'MANUAL' && !url) errors[item.groupJid] = t.manualInviteRequired;
      else if (withField && url && !INVITE_URL_PATTERN.test(url)) errors[item.groupJid] = linkRotationStrings.errors.inviteUrlInvalid;
      return {
        ...(item.conversationId ? { conversationId: item.conversationId } : { groupJid: item.groupJid }),
        position,
        weight: item.weight,
        capacity: item.capacity,
        manualInviteUrl: withField && url ? url : null,
      };
    });
    setItemErrors(errors);
    setError(null);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    try {
      const groups = await linkRotationService.saveGroups(rotation.id, payload);
      clearDraft();
      onSaved(groups);
    } catch (e) {
      const info = linkRotationError(e);
      if (info.code === 'PLAN_LIMIT_REACHED') {
        setBannerLimit(info.limit ?? limit ?? draft.items.length);
      } else if (info.code === 'LINK_INVITE_URL_INVALID') {
        const marked: Record<string, string> = {};
        for (const p of payload) {
          const jid = draft.items[p.position ?? 0]?.groupJid;
          if (jid && p.manualInviteUrl) marked[jid] = info.message;
        }
        setItemErrors(marked);
        if (Object.keys(marked).length === 0) setError(info.message);
      } else {
        setError(info.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const strategyLabel = linkRotationStrings.strategy.label[rotation.strategy];
  const strategyDescription = linkRotationStrings.strategy.description[rotation.strategy];
  const showEmpty = candidates !== null && candidates.groups.length === 0;

  return (
    <Dialog open={open} onClose={saving ? undefined : cancel} fullWidth maxWidth="sm" fullScreen={fullScreen} aria-labelledby="rotation-groups-title">
      <DialogTitle id="rotation-groups-title" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ flex: 1 }}>{t.title}</Box>
        <Tooltip title={t.close} arrow>
          <IconButton aria-label={t.close} onClick={cancel} disabled={saving} edge="end"><AppIcon icon={X} size="sm" /></IconButton>
        </Tooltip>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">{t.subtitle}</Typography>
          <Alert severity="info" icon={<AppIcon icon={Info} />} sx={{ py: 0.25 }}>
            {t.strategyLine(strategyLabel, strategyDescription)}
          </Alert>
          {error && <Alert severity="error">{error}</Alert>}

          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip size="small" color="primary" variant="outlined" label={t.selectedCount(draft.items.length, total)} />
            <Tooltip title={t.planLimitTooltip} arrow describeChild>
              <Chip size="small" variant="outlined" label={t.planLimit(limit)} tabIndex={0} />
            </Tooltip>
          </Stack>

          <Box>
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="overline" color="text.secondary">{t.selectedTitle}</Typography>
              <Tooltip title={t.orderHelp} arrow describeChild>
                <Box component="span" tabIndex={0} aria-label={t.orderHelp} sx={{ display: 'inline-flex', color: 'text.secondary', cursor: 'help' }}>
                  <AppIcon icon={Info} />
                </Box>
              </Tooltip>
            </Stack>
            {draft.items.length === 0 ? (
              <Typography variant="body2" color="text.secondary">{t.noneSelected}</Typography>
            ) : (
              <Stack spacing={1}>
                {draft.items.map((item, i) => {
                  const g = saved.get(item.groupJid);
                  return (
                    <RotationGroupItem
                      key={item.groupJid}
                      item={{ ...item, avatarUrl: item.avatarUrl ?? avatarByJid.get(item.groupJid) ?? null }}
                      index={i}
                      total={draft.items.length}
                      strategy={rotation.strategy}
                      status={g?.status ?? null}
                      memberCount={g?.memberCount ?? null}
                      canRefresh={Boolean(g)}
                      refreshing={refreshing.has(item.groupJid)}
                      error={itemErrors[item.groupJid] ?? null}
                      onChange={(p) => patch(item.groupJid, p)}
                      onMove={(dir) => move(i, dir)}
                      onRemove={() => {
                        setItems((items) => items.filter((x) => x.groupJid !== item.groupJid));
                        clearItemError(item.groupJid);
                      }}
                      onRefresh={() => void refresh(item.groupJid)}
                    />
                  );
                })}
              </Stack>
            )}
          </Box>

          <Box>
            <Typography variant="overline" color="text.secondary">{t.availableTitle}</Typography>
            <TextField
              fullWidth
              size="small"
              placeholder={t.search}
              value={draft.search}
              onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value }))}
              inputProps={{ 'aria-label': t.search }}
              InputProps={{ startAdornment: <InputAdornment position="start"><AppIcon icon={Search} /></InputAdornment> }}
              sx={{ mt: 0.5, mb: 1 }}
            />
            {candidates?.partial && <Alert severity="warning" sx={{ mb: 1 }}>{t.partial}</Alert>}
            {loading && !candidates && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={24} aria-label={t.availableTitle} /></Box>
            )}
            {loadError && (
              <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void load()}>{t.retry}</Button>}>{loadError}</Alert>
            )}
            {showEmpty && <Alert severity="info">{t.empty}</Alert>}
            {!showEmpty && candidates && filtered.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>{t.emptySearch}</Typography>
            )}
            {filtered.length > 0 && (
              <List dense disablePadding sx={{ border: 1, borderColor: 'divider', borderRadius: 2, maxHeight: 320, overflowY: 'auto' }}>
                {filtered.map((c) => {
                  const name = c.title?.trim() || t.untitled;
                  const checked = selected.has(c.groupJid);
                  return (
                    <ListItemButton key={c.groupJid} onClick={() => toggle(c)} selected={checked}>
                      <ListItemIcon sx={{ minWidth: 40 }}>
                        <Checkbox edge="start" checked={checked} tabIndex={-1} disableRipple inputProps={{ 'aria-label': t.selectAria(name) }} />
                      </ListItemIcon>
                      <Box sx={{ mr: 1.5 }}><GroupAvatar title={c.title} avatarUrl={c.avatarUrl} size={32} blurFlag="linkRotation.groupAvatar" /></Box>
                      <ListItemText
                        primary={<Blurred when={blurName} inline>{name}</Blurred>}
                        secondary={c.status ? linkRotationStrings.groupStatus[c.status] : undefined}
                        primaryTypographyProps={{ noWrap: true }}
                      />
                    </ListItemButton>
                  );
                })}
              </List>
            )}
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={cancel} disabled={saving} color="inherit">{t.cancel}</Button>
        <Button variant="contained" onClick={() => void save()} disabled={saving} startIcon={saving ? <CircularProgress size={16} color="inherit" aria-hidden /> : undefined}>
          {t.save}
        </Button>
      </DialogActions>

      {bannerLimit !== null && <PlanLimitBanner open onClose={() => setBannerLimit(null)} kind="groups" limit={bannerLimit} />}
    </Dialog>
  );
}
