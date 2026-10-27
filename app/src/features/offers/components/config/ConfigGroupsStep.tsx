import { useState } from 'react';
import {
  Alert, Box, Button, Card, CardActionArea, Checkbox, Chip, CircularProgress, InputAdornment, Skeleton, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { GroupAvatar } from '../GroupChip';
import { Blurred, useBlur } from '@/features/privacy';
import { useSessionGroups } from '../../hooks/useSessionGroups';
import { offerService } from '@/services/offer.service';
import type { SessionGroupItem } from '@/types/api.types';
import { offerStrings } from '../../strings';

const t = offerStrings.wizard.groups;

export interface SelectedGroup {
  title: string | null;
  avatarUrl: string | null;
}

interface Props {
  sessionId: string;
  /** id → título, mantido fora da lista para a seleção sobreviver à busca. */
  selected: ReadonlyMap<string, SelectedGroup>;
  limit: number | null;
  onToggle: (id: string, group: SelectedGroup) => void;
  onClear: () => void;
}

/** Passo 2: grade de grupos da sessão escolhida, com busca e contador × limite do plano. */
export function ConfigGroupsStep({ sessionId, selected, limit, onToggle, onClear }: Props) {
  const [search, setSearch] = useState('');
  const { items, partial, loading, failed, retry } = useSessionGroups(sessionId, search);
  // Abre sempre resumido: a busca procura em todos; a tela mostra VISIBLE_GROUPS até "Ver todos"
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, VISIBLE_GROUPS);
  const hidden = items.length - shown.length;
  const blurNames = useBlur('offers.groupNames');
  const atLimit = limit != null && selected.size >= limit;
  // Grupo sem conversa ganha uma ao ser marcado; guarda aqui para a lista refletir sem recarregar.
  const [ensured, setEnsured] = useState<ReadonlyMap<string, string>>(new Map());
  const [pendingJid, setPendingJid] = useState<string | null>(null);
  const [ensureFailed, setEnsureFailed] = useState(false);

  const idOf = (g: SessionGroupItem) => g.conversationId ?? ensured.get(g.groupJid) ?? null;

  const toggle = async (g: SessionGroupItem) => {
    const id = idOf(g);
    if (id) {
      onToggle(id, { title: g.title, avatarUrl: g.avatarUrl });
      return;
    }
    setPendingJid(g.groupJid);
    setEnsureFailed(false);
    try {
      const { conversationId } = await offerService.ensureSessionGroup(sessionId, g.groupJid);
      setEnsured((prev) => new Map(prev).set(g.groupJid, conversationId));
      onToggle(conversationId, { title: g.title, avatarUrl: g.avatarUrl });
    } catch {
      setEnsureFailed(true);
    } finally {
      setPendingJid(null);
    }
  };

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField
          size="small"
          label={t.searchLabel}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ flex: '1 1 240px' }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start"><SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} /></InputAdornment>
              ),
            },
          }}
        />
        <Chip
          role="status"
          aria-live="polite"
          aria-label={t.counterAria(selected.size, limit)}
          color={atLimit ? 'warning' : selected.size > 0 ? 'primary' : 'default'}
          variant={selected.size > 0 ? 'filled' : 'outlined'}
          label={t.counter(selected.size, limit)}
          sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
        />
        {selected.size > 0 && (
          <Button size="small" color="inherit" onClick={onClear}>{t.clear}</Button>
        )}
      </Box>

      {partial && !failed && <Alert severity="warning" variant="outlined">{t.partial}</Alert>}
      {ensureFailed && (
        <Alert severity="error" onClose={() => setEnsureFailed(false)}>{t.ensureError}</Alert>
      )}

      {failed ? (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={retry}>{offerStrings.page.retry}</Button>}>
          {t.loadError}
        </Alert>
      ) : loading && items.length === 0 ? (
        <Box sx={gridSx}>
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} variant="rounded" height={64} />)}
        </Box>
      ) : items.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          {search.trim() ? t.emptySearch : t.empty}
        </Typography>
      ) : (
        <Box sx={{ ...gridSx, opacity: loading ? 0.6 : 1, transition: 'opacity 150ms ease' }} aria-busy={loading}>
          {shown.map((g) => {
            const id = idOf(g);
            const checked = id != null && selected.has(id);
            const pending = pendingJid === g.groupJid;
            const blocked = !checked && atLimit;
            const title = g.title || t.untitled;
            const card = (
              <Card
                variant="outlined"
                sx={{
                  borderColor: checked ? 'primary.main' : 'divider',
                  bgcolor: checked ? 'action.selected' : 'background.paper',
                  opacity: blocked ? 0.55 : 1,
                  transition: 'border-color 150ms ease, background-color 150ms ease',
                }}
              >
                <CardActionArea
                  role="checkbox"
                  aria-checked={checked}
                  aria-disabled={blocked}
                  aria-busy={pending}
                  disabled={blocked || pendingJid !== null}
                  onClick={() => void toggle(g)}
                  sx={{ px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 1.25, justifyContent: 'flex-start', minHeight: 60 }}
                >
                  <GroupAvatar title={g.title} avatarUrl={g.avatarUrl} size={36} />
                  <Typography variant="body2" sx={{ fontWeight: 500, flexGrow: 1, minWidth: 0 }} noWrap title={blurNames ? undefined : title}>
                    <Blurred when={blurNames} inline radius={5}>{title}</Blurred>
                  </Typography>
                  {pending ? (
                    <CircularProgress size={18} sx={{ m: 0.75 }} aria-hidden />
                  ) : (
                    <Checkbox checked={checked} tabIndex={-1} disableRipple size="small" sx={{ p: 0.5 }} slotProps={{ input: { 'aria-hidden': true } }} />
                  )}
                </CardActionArea>
              </Card>
            );
            return blocked && limit != null ? (
              <Tooltip key={g.groupJid} title={t.limitTooltip(limit)} arrow>
                {/* span: o Tooltip precisa de um filho que receba eventos mesmo com o cartão desabilitado */}
                <Box component="span" sx={{ display: 'block' }}>{card}</Box>
              </Tooltip>
            ) : (
              <Box key={g.groupJid}>{card}</Box>
            );
          })}
        </Box>
      )}

      {items.length > VISIBLE_GROUPS && (
        <Button
          size="small"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          sx={{ alignSelf: 'flex-start' }}
        >
          {expanded ? t.showLess : t.showAll(hidden)}
        </Button>
      )}
    </Stack>
  );
}

const VISIBLE_GROUPS = 6;

const gridSx = {
  display: 'grid',
  gap: 1.25,
  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' },
} as const;
