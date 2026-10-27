import { Link as RouterLink } from 'react-router-dom';
import { Alert, Avatar, Box, Button, Card, CardActionArea, Chip, Skeleton, Stack, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PhoneIphoneOutlinedIcon from '@mui/icons-material/PhoneIphoneOutlined';
import { EmptyState } from '@/components';
import type { SessionItem } from '@/types/api.types';
import { resolveMediaUrl } from '@/utils/resolveMediaUrl';
import { offerStrings } from '../../strings';
import { Blurred, useBlur } from '@/features/privacy';

const t = offerStrings.wizard.session;

interface Props {
  sessions: SessionItem[];
  loading: boolean;
  failed: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
}

/** Passo 1: só sessões conectadas, em cartões de escolha única. */
export function ConfigSessionStep({ sessions, loading, failed, selectedId, onSelect, onRetry }: Props) {
  const blurSession = useBlur('offers.sessionName');
  if (failed) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={onRetry}>{offerStrings.page.retry}</Button>}>
        {t.loadError}
      </Alert>
    );
  }

  if (loading) {
    return (
      <Box sx={gridSx}>
        {[0, 1].map((i) => <Skeleton key={i} variant="rounded" height={88} />)}
      </Box>
    );
  }

  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={<PhoneIphoneOutlinedIcon />}
        title={t.emptyTitle}
        description={t.emptyDescription}
        action={<Button variant="contained" disableElevation component={RouterLink} to="/sessions">{t.emptyAction}</Button>}
      />
    );
  }

  return (
    <Box role="radiogroup" aria-label={t.title} sx={gridSx}>
      {sessions.map((s) => {
        const selected = s.id === selectedId;
        return (
          <Card
            key={s.id}
            variant="outlined"
            sx={{
              borderColor: selected ? 'primary.main' : 'divider',
              borderWidth: selected ? 2 : 1,
              transition: 'border-color 150ms ease',
            }}
          >
            <CardActionArea
              role="radio"
              aria-checked={selected}
              onClick={() => onSelect(s.id)}
              sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.5, justifyContent: 'flex-start', minHeight: 72 }}
            >
              <Avatar src={resolveMediaUrl(s.avatarUrl ?? null) ?? undefined} alt="" sx={{ width: 44, height: 44 }}>
                <Blurred when={blurSession} inline radius={4}>{s.name.slice(0, 1).toUpperCase()}</Blurred>
              </Avatar>
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Typography variant="subtitle2" noWrap><Blurred when={blurSession} inline radius={5}>{s.name}</Blurred></Typography>
                <Typography variant="body2" color="text.secondary" noWrap><Blurred when={blurSession} inline radius={5}>{s.phone ?? t.noPhone}</Blurred></Typography>
              </Box>
              <Stack alignItems="flex-end" spacing={0.5}>
                {selected
                  ? <CheckCircleIcon color="primary" aria-hidden />
                  : <Chip size="small" color="success" variant="outlined" label={t.connected} />}
              </Stack>
            </CardActionArea>
          </Card>
        );
      })}
    </Box>
  );
}

const gridSx = {
  display: 'grid',
  gap: 1.5,
  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' },
} as const;
