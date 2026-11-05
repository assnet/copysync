import { useCallback, useMemo } from 'react';
import { Alert, Box, Button, Skeleton } from '@mui/material';
import { PageHeader } from '@/components';
import { BroadcastGroupsTable } from '@/features/broadcastGroups/components/BroadcastGroupsTable';
import { useBroadcastGroups } from '@/features/broadcastGroups/hooks/useBroadcastGroups';
import { broadcastGroupsStrings as t } from '@/features/broadcastGroups/strings';
import { useMonitoringSessions } from '@/features/monitoring/hooks/useMonitoringSessions';

/** Catálogo dos grupos de disparo do tenant (gerador + monitoramentos). Filtro vive na tabela (`tab`). */
export function BroadcastGroupsPage() {
  const { data, loading, failed, removing, reload, remove } = useBroadcastGroups();
  // Nome da sessão só para exibir/buscar; falha aqui cai no rótulo "Sessão sem nome"
  const { sessions } = useMonitoringSessions();
  const names = useMemo(() => new Map(sessions.map((s) => [s.id, s.name])), [sessions]);
  const sessionNameOf = useCallback((id: string) => names.get(id) ?? null, [names]);

  return (
    <Box>
      <PageHeader title={t.title} subtitle={t.subtitle} />
      {loading && !data ? (
        <Box aria-busy="true" aria-label={t.loading}>
          <Skeleton variant="rounded" height={40} sx={{ mb: 2, maxWidth: 360 }} />
          <Skeleton variant="rounded" height={280} />
        </Box>
      ) : failed || !data ? (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void reload()}>{t.retry}</Button>}>
          {t.loadError}
        </Alert>
      ) : (
        <BroadcastGroupsTable data={data} sessionNameOf={sessionNameOf} removing={removing} onRemove={remove} />
      )}
    </Box>
  );
}
