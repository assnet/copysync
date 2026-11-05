import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, IconButton, InputAdornment, MenuItem, Snackbar, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { Bot, Radar, Search, Trash2, X } from 'lucide-react';
import { AppIcon, ConfirmDialog } from '@/components';
import { GroupAvatar } from '@/features/offers/components/GroupChip';
import { ChannelCounterChips } from '@/features/offers/components/config/ChannelCounterChips';
import { Blurred, useBlur } from '@/features/privacy';
import { ChannelLogo } from '@/features/sessions/components/ChannelLogo';
import { usePersistedState } from '@/hooks/usePersistedState';
import type { BroadcastGroupCatalogItem, BroadcastGroupUse, BroadcastGroupsResponse, LimitChannel } from '@/types/api.types';
import { broadcastGroupsStrings as t } from '../strings';

const CHANNELS: readonly LimitChannel[] = ['whatsapp', 'telegram'];

export type ChannelFilter = 'all' | LimitChannel;
export interface BroadcastGroupsFilters { channel: ChannelFilter; query: string }
const INITIAL_FILTERS: BroadcastGroupsFilters = { channel: 'all', query: '' };
/** Chave do filtro na aba (`usePersistedState`, escopo `tab`). */
export const BROADCAST_GROUPS_FILTERS_KEY = 'broadcastGroups.filters';

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');

/** Filtro puro: canal + busca (sem acento/caixa) no nome do grupo ou da sessão. */
export function filterBroadcastGroups(
  items: readonly BroadcastGroupCatalogItem[],
  filters: BroadcastGroupsFilters,
  sessionNameOf: (sessionId: string) => string | null,
): BroadcastGroupCatalogItem[] {
  const q = fold(filters.query.trim());
  return items.filter((g) => {
    if (filters.channel !== 'all' && g.channel !== filters.channel) return false;
    if (!q) return true;
    return fold(g.title ?? '').includes(q) || fold(sessionNameOf(g.sessionId) ?? '').includes(q);
  });
}

interface Props {
  data: BroadcastGroupsResponse;
  sessionNameOf: (sessionId: string) => string | null;
  /** `conversationId` em remoção (desliga o botão da linha). */
  removing: string | null;
  /** Tira o grupo de todos os usos; lança em erro. */
  onRemove: (conversationId: string) => Promise<void>;
}

/** Catálogo dos grupos de disparo: uso `n / limite` por canal, filtro, uso por item e remover com confirmação. */
export function BroadcastGroupsTable({ data, sessionNameOf, removing, onRemove }: Props) {
  const blurNames = useBlur('broadcastGroups.groupNames');
  const blurSession = useBlur('broadcastGroups.sessionName');
  const [filters, setFilters, clearFilters] = usePersistedState<BroadcastGroupsFilters>(
    BROADCAST_GROUPS_FILTERS_KEY, INITIAL_FILTERS, { scope: 'tab' },
  );
  const [confirm, setConfirm] = useState<BroadcastGroupCatalogItem | null>(null);
  const [notice, setNotice] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);

  // Canal sem limite no plano (0) e sem uso some dos chips e do filtro
  const channels = CHANNELS.filter((ch) => data.limits[ch].broadcastGroups !== 0 || data.usage[ch].broadcastGroups > 0);
  const count = { whatsapp: data.usage.whatsapp.broadcastGroups, telegram: data.usage.telegram.broadcastGroups };
  const limits = { whatsapp: data.limits.whatsapp.broadcastGroups, telegram: data.limits.telegram.broadcastGroups };
  const over = channels.filter((ch) => limits[ch] != null && count[ch] > limits[ch]!);

  const rows = useMemo(() => filterBroadcastGroups(data.items, filters, sessionNameOf), [data.items, filters, sessionNameOf]);
  const filtered = filters.channel !== 'all' || filters.query.trim() !== '';
  const titleOf = (g: BroadcastGroupCatalogItem) => g.title || t.untitledGroup;
  const sessionOf = (id: string) => sessionNameOf(id) || t.unnamedSession;

  const usageLabel = (use: BroadcastGroupUse) => {
    if (use === 'generator') return t.usedBy.generator;
    // Nome da sessão no chip só sem desfoque (o rótulo não passa pelo `Blurred`)
    return blurSession ? t.usedBy.monitor : t.usedBy.monitorOf(sessionOf(use.slice('monitor:'.length)));
  };

  const doRemove = async () => {
    const g = confirm;
    setConfirm(null);
    if (!g) return;
    try {
      await onRemove(g.conversationId);
      setNotice({ severity: 'success', text: t.remove.success(blurNames ? t.untitledGroup : titleOf(g)) });
    } catch {
      setNotice({ severity: 'error', text: t.remove.error });
    }
  };

  return (
    <Stack spacing={2}>
      {channels.length > 0 && (
        <Tooltip title={t.limitHint} arrow describeChild placement="bottom-start">
          <Box sx={{ alignSelf: 'flex-start' }}>
            <ChannelCounterChips channels={channels} count={count} limits={limits} label={t.usage.label} ariaLabel={t.usage.ariaLabel} />
          </Box>
        </Tooltip>
      )}
      {over.map((ch) => <Alert key={ch} severity="error">{t.usage.overLimit(ch)}</Alert>)}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
        <TextField
          select
          size="small"
          label={t.filters.channel}
          value={filters.channel}
          onChange={(e) => setFilters((f) => ({ ...f, channel: e.target.value as ChannelFilter }))}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="all">{t.filters.channelAll}</MenuItem>
          {CHANNELS.map((ch) => <MenuItem key={ch} value={ch}>{t.channelLabel(ch)}</MenuItem>)}
        </TextField>
        <TextField
          size="small"
          placeholder={t.filters.search}
          value={filters.query}
          onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
          slotProps={{
            htmlInput: { 'aria-label': t.filters.searchAria },
            input: { startAdornment: <InputAdornment position="start"><AppIcon icon={Search} size="sm" /></InputAdornment> },
          }}
          sx={{ flex: 1, minWidth: 0 }}
        />
        {filtered && (
          <Button color="inherit" startIcon={<AppIcon icon={X} size="sm" />} onClick={clearFilters} sx={{ flexShrink: 0 }}>
            {t.filters.clear}
          </Button>
        )}
      </Stack>

      <Typography variant="body2" color="text.secondary" role="status" aria-live="polite">{t.results(rows.length)}</Typography>

      {rows.length === 0 ? (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{filtered ? t.noResultsTitle : t.emptyTitle}</Typography>
          <Typography variant="body2" color="text.secondary">{filtered ? t.noResultsDescription : t.emptyDescription}</Typography>
        </Box>
      ) : (
        <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 2 }}>
          <Table size="small" aria-label={t.title}>
            <TableHead>
              <TableRow>
                <TableCell>{t.columns.group}</TableCell>
                <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{t.columns.session}</TableCell>
                <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>{t.columns.usedBy}</TableCell>
                <TableCell align="right">{t.columns.actions}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((g) => {
                const title = titleOf(g);
                const session = sessionOf(g.sessionId);
                return (
                  <TableRow key={g.conversationId} hover>
                    <TableCell sx={{ maxWidth: 0, width: '50%' }}>
                      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', minWidth: 0 }}>
                        <GroupAvatar title={g.title} avatarUrl={g.avatarUrl} size={32} blurFlag="broadcastGroups.groupAvatars" />
                        <Box sx={{ minWidth: 0 }}>
                          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}>
                            <ChannelLogo channel={g.channel} size="sm" labelled />
                            <Blurred when={blurNames} inline>
                              <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{title}</Typography>
                            </Blurred>
                          </Stack>
                          <Box sx={{ display: { xs: 'block', md: 'none' } }}>
                            <Blurred when={blurSession} inline>
                              <Typography variant="caption" color="text.secondary" noWrap>{session}</Typography>
                            </Blurred>
                          </Box>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                      <Blurred when={blurSession} inline>
                        <Typography variant="body2" noWrap>{session}</Typography>
                      </Blurred>
                    </TableCell>
                    <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                        {g.usedBy.map((use) => (
                          <Tooltip key={use} title={use === 'generator' ? t.usedBy.generatorTooltip : t.usedBy.monitorTooltip} arrow describeChild>
                            <Chip
                              size="small"
                              variant="outlined"
                              icon={<AppIcon icon={use === 'generator' ? Bot : Radar} size="sm" />}
                              label={usageLabel(use)}
                            />
                          </Tooltip>
                        ))}
                      </Stack>
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title={t.remove.tooltip} arrow describeChild>
                        <span>
                          <IconButton
                            aria-label={t.remove.ariaLabel(title)}
                            onClick={() => setConfirm(g)}
                            disabled={removing === g.conversationId}
                            color="error"
                            sx={{ width: 44, height: 44 }}
                          >
                            <AppIcon icon={Trash2} size="md" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <ConfirmDialog
        open={confirm != null}
        title={t.remove.confirmTitle}
        description={confirm ? t.remove.confirmBody(blurNames ? t.untitledGroup : titleOf(confirm), confirm.usedBy.length) : ''}
        confirmLabel={t.remove.confirm}
        cancelLabel={t.remove.cancel}
        confirmColor="error"
        onConfirm={() => void doRemove()}
        onClose={() => setConfirm(null)}
      />
      <Snackbar open={notice != null} autoHideDuration={5000} onClose={() => setNotice(null)}>
        {notice ? <Alert severity={notice.severity} onClose={() => setNotice(null)} variant="filled">{notice.text}</Alert> : undefined}
      </Snackbar>
    </Stack>
  );
}
