import { Link as RouterLink } from 'react-router-dom';
import { Alert, AlertTitle, Box, Button, Chip, Stack, Tooltip, Typography } from '@mui/material';
import { Crown, ExternalLink } from 'lucide-react';
import { AppIcon, SectionCard } from '@/components';
import { AFFILIATE_PLANS_PATH } from '@/features/navigation';
import { PLAN_CATALOG } from '@/features/plans/catalog';
import { buildCheckoutUrl } from '@/features/plans/checkout';
import { Blurred, useBlur } from '@/features/privacy';
import { serverNow } from '@/services/serverClock';
import type { SubscriptionResponse, SubscriptionStatus } from '@/types/api.types';
import { subscriptionStrings } from '../strings';

const t = subscriptionStrings;

type ChipColor = 'success' | 'warning' | 'error' | 'default';
const STATUS_COLOR: Record<SubscriptionStatus, ChipColor> = { ACTIVE: 'success', SUSPENDED: 'warning', CANCELLED: 'error' };

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' });

/** Data local do ISO; ISO inválido → `null` (não mostra). */
function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : dateFormat.format(d);
}

/** Linha de vencimento: suspensa mostra desde quando; senão renova/venceu pelo `expiresAt` (relógio do servidor). */
function expiryLine(sub: SubscriptionResponse): string | null {
  if (sub.status === 'SUSPENDED') {
    const since = formatDate(sub.suspendedAt);
    if (since) return t.expiry.suspendedOn(since);
  }
  const date = formatDate(sub.expiresAt);
  if (!date || !sub.expiresAt) return null;
  return new Date(sub.expiresAt).getTime() > serverNow() ? t.expiry.renewsOn(date) : t.expiry.expiredOn(date);
}

export interface SubscriptionPlanCardProps {
  subscription: SubscriptionResponse;
  /** D4: só ADMIN confirmado assina (padrão `false`); os demais veem o aviso para falar com o administrador. */
  canSubscribe?: boolean;
  /** Query da URL atual (repassa `utm_*`/`gclid`/`fbclid` ao checkout). */
  search?: string;
}

/**
 * Card do plano atual (SUB-06/07/09): nome e tagline do catálogo pelo slug (nunca preço), chip de
 * situação, vencimento em data local, conta (borrável) e botão para a página de venda. Sem
 * `VITE_BILLING_CHECKOUT_URL` ou sem plano, o botão leva à vitrine interna.
 */
export function SubscriptionPlanCard({ subscription: sub, canSubscribe = false, search = window.location.search }: SubscriptionPlanCardProps) {
  const blurTenant = useBlur('subscription.tenantName');
  const plan = PLAN_CATALOG.find((p) => p.slug === sub.planSlug) ?? null;
  const checkoutUrl = plan ? buildCheckoutUrl(plan.slug, 'monthly', search) : null;
  const expiry = expiryLine(sub);
  const pending = sub.status === 'ACTIVE' ? null : t.pending[sub.status];
  const statusLabel = plan || sub.status !== 'ACTIVE' ? t.status[sub.status] : t.status.noPlan;
  const statusColor: ChipColor = plan || sub.status !== 'ACTIVE' ? STATUS_COLOR[sub.status] : 'default';

  const cta = checkoutUrl ? (
    <Button
      variant="contained"
      disableElevation
      href={checkoutUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t.cta.newTab}
      startIcon={<AppIcon icon={Crown} />}
      endIcon={<AppIcon icon={ExternalLink} />}
    >
      {t.cta.label}
    </Button>
  ) : (
    <Button variant="contained" disableElevation component={RouterLink} to={AFFILIATE_PLANS_PATH} startIcon={<AppIcon icon={Crown} />}>
      {t.cta.label}
    </Button>
  );

  return (
    <SectionCard>
      <Stack spacing={2}>
        {pending && (
          <Alert severity="warning" role="alert">
            <AlertTitle>{pending.title}</AlertTitle>
            {pending.description}
          </Alert>
        )}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="overline" color="text.secondary">{t.plan.eyebrow}</Typography>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="h5" component="h2" fontWeight={700}>{plan?.name ?? t.plan.noPlan}</Typography>
              <Chip size="small" color={statusColor} label={statusLabel} aria-label={`${t.status.label}: ${statusLabel}`} />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{plan?.tagline ?? t.plan.noPlanTagline}</Typography>
            {expiry && <Typography variant="body2" sx={{ mt: 1 }}>{expiry}</Typography>}
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t.plan.tenantLabel}: <Blurred when={blurTenant} inline radius={5}>{sub.tenantName}</Blurred>
            </Typography>
          </Box>
          <Box sx={{ flexShrink: 0 }}>
            {canSubscribe ? (
              <Tooltip title={t.cta.tooltip} arrow describeChild>{cta}</Tooltip>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 260 }}>{t.cta.operatorHint}</Typography>
            )}
          </Box>
        </Stack>
      </Stack>
    </SectionCard>
  );
}
