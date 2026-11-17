import { Alert, Box, Button, Divider, Skeleton, Stack, Switch, Tooltip, Typography } from '@mui/material';
import { UserRound, Users } from 'lucide-react';
import { AppIcon, EmptyState, SectionCard } from '@/components';
import { Blurred } from '@/features/privacy/components/Blurred';
import { useBlur } from '@/features/privacy/PrivacyContext';
import type { SaverExportGrantsState } from '../hooks';
import { saverStrings as s } from '../strings';

interface Props {
  grants: SaverExportGrantsState;
}

/** "Quem pode exportar": operadores com o `Switch` da liberação (só `ADMIN` recebe esta seção). */
export function SaverExportGrantsSection({ grants }: Props) {
  const blurTeam = useBlur('saver.teamNames');
  const t = s.grants;
  const { data, loading, error, reload, pending, toggle, toggleError, clearToggleError } = grants;

  return (
    <SectionCard title={t.title} subtitle={t.subtitle}>
      {toggleError && (
        <Alert severity="error" onClose={clearToggleError} sx={{ mb: 2 }}>{t.toggleFailed}</Alert>
      )}
      {loading && !data ? (
        <Stack spacing={1.5} aria-busy="true">
          {[0, 1].map((i) => <Skeleton key={i} variant="rounded" height={52} />)}
        </Stack>
      ) : error ? (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void reload()}>{s.settings.retry}</Button>}>
          {t.loadError}
        </Alert>
      ) : !data || data.length === 0 ? (
        <EmptyState icon={<AppIcon icon={Users} size="lg" />} title={t.empty} description={t.emptyHint} />
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {data.map((g, i) => (
            <Box component="li" key={g.userId}>
              {i > 0 && <Divider />}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1.25, minHeight: 52 }}>
                <Box sx={{ color: 'text.secondary', display: 'inline-flex', flexShrink: 0 }} aria-hidden>
                  <AppIcon icon={UserRound} size="sm" />
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Blurred when={blurTeam}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{g.name}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap component="p">{g.email}</Typography>
                  </Blurred>
                </Box>
                <Typography variant="caption" color={g.canExport ? 'success.main' : 'text.secondary'} sx={{ display: { xs: 'none', sm: 'block' } }}>
                  {g.canExport ? t.allowed : t.blocked}
                </Typography>
                <Tooltip title={g.canExport ? t.tooltipOn : t.tooltipOff} arrow describeChild>
                  <span>
                    <Switch
                      checked={g.canExport}
                      disabled={pending.has(g.userId)}
                      onChange={(_e, v) => void toggle(g.userId, v)}
                      slotProps={{ input: { 'aria-label': t.switchLabel(g.name) } }}
                    />
                  </span>
                </Tooltip>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </SectionCard>
  );
}
