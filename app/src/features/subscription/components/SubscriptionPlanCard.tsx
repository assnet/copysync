import { Link as RouterLink } from 'react-router-dom';
import { Alert, AlertTitle, Box, Button, Chip, Stack, Tooltip, Typography } from '@mui/material';
import { Crown } from 'lucide-react';
import { AppIcon, SectionCard } from '@/components';
import { navigationStrings } from '@/features/navigation';
import { SUBSCRIPTION_PATH, plansPathFor } from '@/features/products';
import { PLAN_CATALOG } from '@/features/plans/catalog';
import { Blurred, useBlur } from '@/features/privacy';
import { serverNow } from '@/services/serverClock';
import type { SubscriptionResponse, SubscriptionStatus } from '@/types/api.types';
import { subscriptionStrings } from '../strings';
import { productLabel, type SubscriptionProductCard } from '../productLimits';

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
function expiryLine(sub: SubscriptionResponse, expiresAt: string | null): string | null {
  if (sub.status === 'SUSPENDED') {
    const since = formatDate(sub.suspendedAt);
    if (since) return t.expiry.suspendedOn(since);
  }
  const date = formatDate(expiresAt);
  if (!date || !expiresAt) return null;
  return new Date(expiresAt).getTime() > serverNow() ? t.expiry.renewsOn(date) : t.expiry.expiredOn(date);
}

/** Tagline do produto (mesma do menu); Afiliados usa a do catálogo de planos. */
const PRODUCT_TAGLINE: Record<string, string> = { SAVER: navigationStrings.products.saver.tagline };

export interface SubscriptionPlanCardProps {
  subscription: SubscriptionResponse;
  /** D4: só ADMIN confirmado assina (padrão `false`); os demais veem o aviso para falar com o administrador. */
  canSubscribe?: boolean;
  /** Query da URL atual (repassa `utm_*`/`gclid`/`fbclid` ao checkout). */
  search?: string;
  /** Produto do cartão (assinatura por produto). Ausente = Afiliados, com os campos do topo. */
  product?: SubscriptionProductCard;
  /** Mais de um cartão na tela: o título indica o produto. */
  multiProduct?: boolean;
  /** Aviso de pendência da conta: só no primeiro cartão. Padrão `true`. */
  showPending?: boolean;
}

/**
 * Card do plano atual (SUB-06/07/09): nome e tagline do catálogo pelo slug (nunca preço), chip de
 * situação, vencimento em data local, conta (borrável) e botão para a vitrine interna, onde o
 * cliente escolhe plano e período (mensal/anual) antes do pagamento. Nunca leva direto ao pagamento
 * do plano atual: quem quer trocar de plano ou assina o anual pagaria a oferta errada.
 */
export function SubscriptionPlanCard({
  subscription: sub, canSubscribe = false, product, multiProduct = false, showPending = true,
}: SubscriptionPlanCardProps) {
  const blurTenant = useBlur('subscription.tenantName');
  const key = product?.product ?? 'AFFILIATES';
  const affiliates = key === 'AFFILIATES';
  const label = productLabel(key);
  const catalogPlan = affiliates ? PLAN_CATALOG.find((p) => p.slug === sub.planSlug) ?? null : null;
  const tier = product?.item.tier ?? null;
  const planName = affiliates ? catalogPlan?.name ?? null : tier ? t.plan.productPlanName(label, tier.toUpperCase()) : null;
  const tagline = affiliates ? catalogPlan?.tagline ?? t.plan.noPlanTagline : PRODUCT_TAGLINE[key] ?? t.plan.noPlanTagline;
  const expiry = expiryLine(sub, affiliates ? sub.expiresAt : product?.item.expiresAt ?? null);
  const eyebrow = multiProduct || !affiliates ? t.plan.productEyebrow(label) : t.plan.eyebrow;
  const pending = !showPending || sub.status === 'ACTIVE' ? null : t.pending[sub.status];
  const hasPlan = planName !== null;
  const statusLabel = hasPlan || sub.status !== 'ACTIVE' ? t.status[sub.status] : t.status.noPlan;
  const statusColor: ChipColor = hasPlan || sub.status !== 'ACTIVE' ? STATUS_COLOR[sub.status] : 'default';
  // Vitrine do produto; sem vitrine registrada cairia nesta própria tela: sem botão.
  const plansPath = plansPathFor(key);

  const cta = (
    <Button variant="contained" disableElevation component={RouterLink} to={plansPath} startIcon={<AppIcon icon={Crown} />}>
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
            <Typography variant="overline" color="text.secondary">{eyebrow}</Typography>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="h5" component="h2" fontWeight={700}>{planName ?? t.plan.noPlan}</Typography>
              <Chip size="small" color={statusColor} label={statusLabel} aria-label={`${t.status.label}: ${statusLabel}`} />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{tagline}</Typography>
            {expiry && <Typography variant="body2" sx={{ mt: 1 }}>{expiry}</Typography>}
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t.plan.tenantLabel}: <Blurred when={blurTenant} inline radius={5}>{sub.tenantName}</Blurred>
            </Typography>
          </Box>
          <Box sx={{ flexShrink: 0 }}>
            {plansPath === SUBSCRIPTION_PATH ? null : canSubscribe ? (
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
