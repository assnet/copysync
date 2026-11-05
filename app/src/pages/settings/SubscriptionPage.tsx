import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, Skeleton, Stack } from '@mui/material';
import { RotateCw } from 'lucide-react';
import { AppIcon, PageHeader } from '@/components';
import { useTenant } from '@/contexts/TenantContext';
import { usePersistedState } from '@/hooks/usePersistedState';
import { subscriptionService } from '@/services/subscription.service';
import { SubscriptionPlanCard } from '@/features/subscription/components/SubscriptionPlanCard';
import { SubscriptionLimitsTable } from '@/features/subscription/components/SubscriptionLimitsTable';
import { subscriptionStrings, type SubscriptionChannel } from '@/features/subscription/strings';
import type { SubscriptionResponse } from '@/types/api.types';

const t = subscriptionStrings;
const isChannel = (v: unknown): v is SubscriptionChannel => v === 'whatsapp' || v === 'telegram';

/**
 * Configurações > Assinatura (SUB-10, D3): plano, situação e uso × limite. Dado do servidor é
 * recarregado a cada visita (nunca persistido); só a aba de canal fica em `usePersistedState` (`tab`).
 */
export function SubscriptionPage() {
  const [params] = useSearchParams();
  const { tenants, activeTenantId } = useTenant();
  const [channel, setChannel] = usePersistedState<SubscriptionChannel>('subscription.channel', 'whatsapp', {
    deserialize: (raw) => (isChannel(raw) ? raw : 'whatsapp'),
  });
  const [data, setData] = useState<SubscriptionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    // Zera antes de buscar: ao trocar de conta, nada do tenant anterior aparece (skeleton).
    setData(null);
    setLoading(true);
    setFailed(false);
    try {
      const sub = await subscriptionService.getSubscription();
      if (id === reqId.current) setData(sub);
    } catch {
      if (id === reqId.current) setFailed(true);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, activeTenantId]);

  // D4: só ADMIN confirmado vê o botão; papel desconhecido (lista carregando ou tenant fora dela) esconde.
  const role = tenants.find((x) => x.id === activeTenantId)?.role;
  const canSubscribe = role === 'ADMIN';
  const redirected = params.get('suspended') === '1' && data != null && data.status !== 'ACTIVE';

  return (
    <Box>
      <PageHeader title={t.page.title} subtitle={t.page.subtitle} />
      {loading && !data ? (
        <Stack spacing={3} aria-busy="true" aria-label={t.page.title}>
          <Skeleton variant="rounded" height={180} />
          <Skeleton variant="rounded" height={360} />
        </Stack>
      ) : failed || !data ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" startIcon={<AppIcon icon={RotateCw} size="sm" />} onClick={() => void load()}>
              {t.page.retry}
            </Button>
          }
        >
          {t.page.loadError}
        </Alert>
      ) : (
        <Stack spacing={3}>
          {redirected && <Alert severity="info">{t.pending.redirected}</Alert>}
          <SubscriptionPlanCard subscription={data} canSubscribe={canSubscribe} />
          <SubscriptionLimitsTable limits={data.limits} channel={channel} onChannelChange={setChannel} />
        </Stack>
      )}
    </Box>
  );
}
