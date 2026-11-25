import { useState } from 'react';
import {
  Alert, Box, Button, Divider, IconButton, Stack, Switch, Tooltip, Typography,
  type ChipProps,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import AddLinkIcon from '@mui/icons-material/AddLink';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import { CircleHelp, ListChecks, Lock } from 'lucide-react';
import { AppIcon, ConfirmDialog } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { PlanAvailabilityBadges } from '@/features/plans/components/PlanAvailabilityBadges';
import { toPanelPlanSlugs } from '@/features/plans/planSlug';
import type { AffiliateCredentialItem, AffiliateCredentialStatus, MarketplaceAvailability } from '@/types/api.types';
import type { AffiliateProviderSpec } from '../affiliateProviders';
import { settingsStrings } from '../strings';
import { AffiliateCardShell } from './AffiliateCardShell';

const t = settingsStrings.affiliate;
const SECRET_MASK = '••••••••';

interface Props {
  spec: AffiliateProviderSpec;
  item?: AffiliateCredentialItem;
  /** Plano da loja (`enabled: false` = card travado com selo dos planos). Ausente = sem restrição. */
  availability?: MarketplaceAvailability;
  busy?: boolean;
  onConfigure: () => void;
  onRemove: () => void;
  onStatusChange: (status: AffiliateCredentialStatus) => void;
  /** Botão "Ver planos" do card travado (a página navega; o card fica sem roteador). */
  onOpenPlans?: () => void;
}

function stateChip(item?: AffiliateCredentialItem, locked?: boolean): ChipProps {
  if (locked) return { label: t.locked.chip, color: 'default', variant: 'outlined', icon: <AppIcon icon={Lock} size="sm" /> };
  if (!item) return { label: t.statusNotConfigured, color: 'default', variant: 'outlined', icon: <RadioButtonUncheckedIcon /> };
  // Recusa é fato observado no uso: prevalece sobre o status escolhido pelo usuário
  if (item.rejectedAt) return { label: t.statusRejected, color: 'error', icon: <ErrorOutlineIcon /> };
  if (item.status === 'INACTIVE') return { label: t.statusInactive, color: 'warning', icon: <PauseCircleOutlineIcon /> };
  return { label: t.statusConfigured, color: 'success', icon: <CheckCircleIcon /> };
}

function ReadOnlyField({ label, value, muted, blur }: { label: string; value: string; muted?: boolean; blur?: boolean }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
      <Typography
        variant="body2"
        fontWeight={500}
        color={muted ? 'text.secondary' : 'text.primary'}
        sx={{ fontFamily: muted ? undefined : 'monospace', wordBreak: 'break-all' }}
      >
        <Blurred when={!!blur} inline radius={5}>{value}</Blurred>
      </Typography>
    </Box>
  );
}

/**
 * Estado de uma credencial de afiliado. Só exibe valores mascarados: o identificador em
 * claro existe apenas dentro do diálogo de edição.
 *
 * Cabeçalho próprio (não `SectionCard`): logo à esquerda do nome e faixa com a cor da marca.
 */
export function AffiliateCredentialCard({ spec, item, availability, busy, onConfigure, onRemove, onStatusChange, onOpenPlans }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const locked = availability?.enabled === false;
  const chip = stateChip(item, locked);
  const active = item?.status === 'ACTIVE';
  // Provider com lista de etiquetas (ML): `identifierLimit` numérico. Contagem efetiva respeita o plano.
  const hasIdentifierList = item?.identifierLimit != null;
  // Identificador público (etiqueta, ID de rastreamento, Publisher ID…) é da conta do cliente: borra em todo provider.
  const blurIdentifiers = useBlur('affiliateCredentials.accountIdentifiers');
  const linkedCount = item && hasIdentifierList
    ? Math.min((item.publicIdentifier ? 1 : 0) + (item.linkedIdentifiers?.length ?? 0), Math.max(1, item.identifierLimit!))
    : 0;

  return (
    <AffiliateCardShell spec={spec} chip={chip} chipMuted={!item || locked}>
        {spec.programRules && spec.programRules.length > 0 && (
          <Box
            component="section"
            aria-labelledby={`program-rules-${spec.provider}`}
            sx={{ p: 1.5, borderRadius: 1, border: 1, borderColor: 'divider' }}
          >
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.75 }}>
              <AppIcon icon={ListChecks} size="sm" style={{ opacity: 0.8 }} />
              <Typography id={`program-rules-${spec.provider}`} variant="caption" component="h3" sx={{ fontWeight: 700 }}>
                {t.programRulesTitle}
              </Typography>
              <Tooltip title={t.programRulesTooltip} arrow>
                <Box component="span" tabIndex={0} sx={{ display: 'inline-flex', color: 'text.secondary', cursor: 'help' }}>
                  <AppIcon icon={CircleHelp} size="sm" label={t.programRulesTooltip} />
                </Box>
              </Tooltip>
            </Stack>
            <Box component="ul" sx={{ m: 0, pl: 2.25, display: 'grid', gap: 0.5 }}>
              {spec.programRules.map((rule) => (
                <Typography component="li" key={rule} variant="body2" color="text.secondary">{rule}</Typography>
              ))}
            </Box>
          </Box>
        )}

        {locked && (
          <Stack spacing={1.25} sx={{ p: 1.5, borderRadius: 1, bgcolor: 'action.hover', border: 1, borderColor: 'divider' }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="body2" fontWeight={600}>{t.locked.title}</Typography>
              <PlanAvailabilityBadges plans={toPanelPlanSlugs(availability?.plans ?? [])} />
            </Stack>
            <Typography variant="body2" color="text.secondary">{t.locked.hint(spec.name)}</Typography>
          </Stack>
        )}

        {item && (
          <Stack
            spacing={1.25}
            sx={{ p: 1.5, borderRadius: 1, bgcolor: 'action.hover', border: 1, borderColor: 'divider' }}
          >
            <ReadOnlyField
              label={spec.publicField?.label ?? t.fields.sessionAffiliateId}
              value={item.publicIdentifierMasked ?? t.idPending}
              muted={!item.publicIdentifierMasked}
              blur={blurIdentifiers}
            />
            {hasIdentifierList && (
              <Typography variant="caption" color="text.secondary" data-testid="linked-identifiers-count">
                {t.identifiers.cardLinked(linkedCount)}
              </Typography>
            )}
            {spec.secretField && (
              <ReadOnlyField
                label={spec.secretField.label}
                value={item.hasSecret ? SECRET_MASK : t.notInformed}
                muted={!item.hasSecret}
              />
            )}
          </Stack>
        )}

        {item?.rejectedAt && (
          <Alert severity="error" variant="outlined" sx={{ py: 0 }}>
            {t.rejectedSince(item.rejectedAt)} {t.rejectedHint[spec.provider] ?? ''}
          </Alert>
        )}

        {spec.usesBrowserSession && (
          item?.hasSession && item.sessionSyncedAt ? (
            <Alert severity="success" variant="outlined" sx={{ py: 0 }}>{t.sessionSynced(item.sessionSyncedAt)}</Alert>
          ) : (
            <Alert severity="info" variant="outlined" sx={{ py: 0 }}>{t.sessionMissing}</Alert>
          )
        )}

        <Box sx={{ flexGrow: 1 }} />
        <Divider />

        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          {locked && !item ? (
            <Tooltip title={t.locked.tooltip} describeChild>
              <Button variant="contained" fullWidth startIcon={<AppIcon icon={Lock} size="sm" />} onClick={onOpenPlans}>
                {t.locked.action}
              </Button>
            </Tooltip>
          ) : item ? (
            <Button variant="outlined" size="small" startIcon={<EditOutlinedIcon />} onClick={onConfigure} disabled={busy}>
              {t.edit}
            </Button>
          ) : (
            <Button variant="contained" startIcon={<AddLinkIcon />} onClick={onConfigure} disabled={busy} fullWidth>
              {t.connect(spec.name)}
            </Button>
          )}

          {item && (
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <Tooltip title={active ? t.deactivateTooltip : t.activateTooltip}>
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="caption" color="text.secondary" component="span">{t.activeLabel}</Typography>
                  <Switch
                    size="small"
                    checked={active}
                    disabled={busy}
                    onChange={(_, checked) => onStatusChange(checked ? 'ACTIVE' : 'INACTIVE')}
                    inputProps={{ 'aria-label': t.activeLabel }}
                  />
                </Box>
              </Tooltip>
              <Tooltip title={t.removeTooltip}>
                <span>
                  <IconButton
                    size="small"
                    color="error"
                    aria-label={t.remove}
                    onClick={() => setConfirmOpen(true)}
                    disabled={busy}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          )}
        </Stack>

      <ConfirmDialog
        open={confirmOpen}
        title={t.removeTitle(spec.name)}
        description={spec.usesBrowserSession ? t.removeBrowserSessionDescription : t.removeDescription}
        confirmLabel={t.removeConfirm}
        cancelLabel={t.cancel}
        confirmColor="error"
        onConfirm={() => {
          setConfirmOpen(false);
          onRemove();
        }}
        onClose={() => setConfirmOpen(false)}
      />
    </AffiliateCardShell>
  );
}
