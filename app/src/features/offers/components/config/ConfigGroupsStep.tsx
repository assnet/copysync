import { useState } from 'react';
import {
  Alert, Avatar, Box, Button, Card, CardActionArea, Checkbox, Chip, InputAdornment, Skeleton, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import { useSessionGroups } from '../../hooks/useSessionGroups';
import { offerStrings } from '../../strings';

const t = offerStrings.wizard.groups;

interface Props {
  sessionId: string;
  /** id → título, mantido fora da lista para a seleção sobreviver à busca. */
  selected: ReadonlyMap<string, string | null>;
  limit: number | null;
  onToggle: (id: string, title: string | null) => void;
  onClear: () => void;
}

/** Passo 2: grade de grupos da sessão escolhida, com busca e contador × limite do plano. */
export function ConfigGroupsStep({ sessionId, selected, limit, onToggle, onClear }: Props) {
  const [search, setSearch] = useState('');
  const { items, loading, failed, retry } = useSessionGroups(sessionId, search);
  const atLimit = limit != null && selected.size >= limit;

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
          {items.map((g) => {
            const checked = selected.has(g.id);
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
                  disabled={blocked}
                  onClick={() => onToggle(g.id, g.title)}
                  sx={{ px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 1.25, justifyContent: 'flex-start', minHeight: 60 }}
                >
                  <Avatar sx={{ width: 36, height: 36, bgcolor: 'action.hover', color: 'text.secondary' }} aria-hidden>
                    <GroupsOutlinedIcon fontSize="small" />
                  </Avatar>
                  <Typography variant="body2" sx={{ fontWeight: 500, flexGrow: 1, minWidth: 0 }} noWrap title={title}>
                    {title}
                  </Typography>
                  <Checkbox checked={checked} tabIndex={-1} disableRipple size="small" sx={{ p: 0.5 }} slotProps={{ input: { 'aria-hidden': true } }} />
                </CardActionArea>
              </Card>
            );
            return blocked && limit != null ? (
              <Tooltip key={g.id} title={t.limitTooltip(limit)} arrow>
                {/* span: o Tooltip precisa de um filho que receba eventos mesmo com o cartão desabilitado */}
                <Box component="span" sx={{ display: 'block' }}>{card}</Box>
              </Tooltip>
            ) : (
              <Box key={g.id}>{card}</Box>
            );
          })}
        </Box>
      )}
    </Stack>
  );
}

const gridSx = {
  display: 'grid',
  gap: 1.25,
  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' },
} as const;
