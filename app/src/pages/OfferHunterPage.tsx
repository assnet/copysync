import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Paper, Snackbar, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { Crosshair, Plus } from 'lucide-react';
import { AppIcon, ConfirmDialog, EmptyState, PageHeader } from '@/components';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { usePersistedState } from '@/hooks/usePersistedState';
import { serverNow } from '@/services/serverClock';
import { offerHunterErrorMessage, offerHunterStrings as t } from '@/features/offerHunter/strings';
import {
  useHuntOptions, useHunterSettings, useHuntUsage, useOfferHunts,
} from '@/features/offerHunter/hooks';
import type { Hunt } from '@/features/offerHunter/types';
import { HuntWizardDialog } from '@/features/offerHunter/components/wizard/HuntWizardDialog';
import { HunterRiskNoticeDialog } from '@/features/offerHunter/components/HunterRiskNoticeDialog';
import { HunterGatesPanel } from '@/features/offerHunter/components/home/HunterGatesPanel';
import { HuntUsageBar } from '@/features/offerHunter/components/home/HuntUsageBar';
import {
  HunterDestinationCard, type HunterDestinationCardHandle,
} from '@/features/offerHunter/components/home/HunterDestinationCard';
import { HuntCard, HuntCardSkeleton } from '@/features/offerHunter/components/home/HuntCard';
import { useHunterSessions } from '@/features/offerHunter/components/home/useHunterSessions';

type HuntFilter = 'ALL' | 'ACTIVE' | 'PAUSED';
interface WizardState { open: boolean; huntId: string | null }
const WIZARD_CLOSED: WizardState = { open: false, huntId: null };
const TICK_MS = 30_000;

/** Relógio do servidor re-lido a cada 30 s (`setTimeout` re-armado, nunca `setInterval`). */
function useServerNow(): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const timer = setTimeout(() => setNow(serverNow()), TICK_MS);
    return () => clearTimeout(timer);
  }, [now]);
  return now;
}

/** Tela inicial do Caçador de Ofertas (`/offer-hunter`, sob `OfferHunterRoute`). */
export function OfferHunterPage() {
  const { user } = useAuth();
  const { tenants, activeTenantId } = useTenant();
  // Só ADMIN confirmado aceita o aviso; super admin recebe 403 da API.
  const isSuperAdmin = Boolean(user?.isSuperAdmin);
  // Aviso do caçador: admin do tenant ou super admin (a prévia só aparece para ele; API aceita no escopo OFFER_HUNTER).
  const canAcceptRisk = isSuperAdmin || tenants.find((x) => x.id === activeTenantId)?.role === 'ADMIN';

  const opts = useHuntOptions();
  const usage = useHuntUsage();
  const settings = useHunterSettings();
  const hunts = useOfferHunts();
  const sessions = useHunterSessions();
  const now = useServerNow();

  const [wizard, setWizard, clearWizard] = usePersistedState<WizardState>('offerHunter.home.wizard', WIZARD_CLOSED, { scope: 'tab', version: 1 });
  const [filter, setFilter] = usePersistedState<HuntFilter>('offerHunter.home.filter', 'ALL', { scope: 'tab', version: 1 });
  const [riskOpen, setRiskOpen] = useState(false);
  const [removing, setRemoving] = useState<Hunt | null>(null);
  const [snack, setSnack] = useState<{ severity: 'success' | 'error' | 'info'; text: string } | null>(null);
  const destinationRef = useRef<HunterDestinationCardHandle>(null);

  const { options, blockedBy } = opts;
  const list = hunts.hunts;
  const huntsMax = options?.limits.huntsMax ?? 5;
  const atLimit = (list?.length ?? 0) >= huntsMax;
  const planClosed = Boolean(options && (!options.gates.plan || !options.gates.hunterEntitlement));
  const blockedTitle = blockedBy ? t.gates[blockedBy].title : null;

  const createTooltip = !options
    ? t.page.loading
    : blockedTitle ? t.home.createBlocked(blockedTitle)
      : atLimit ? t.list.limitTooltip(huntsMax) : t.list.createTooltip;
  const canCreate = Boolean(options) && !blockedBy && !atLimit;

  const editing = wizard.huntId ? list?.find((h) => h.id === wizard.huntId) : undefined;
  // Caçada em edição sumiu (excluída em outra aba): fecha o assistente.
  useEffect(() => {
    if (wizard.huntId && list && !list.some((h) => h.id === wizard.huntId)) clearWizard();
  }, [wizard.huntId, list, clearWizard]);

  const visible = useMemo(
    () => (list ?? []).filter((h) => filter === 'ALL' || h.status === filter),
    [list, filter],
  );

  const handleSaved = useCallback((hunt: Hunt) => {
    hunts.setData((cur) => {
      const items = cur ?? [];
      return items.some((h) => h.id === hunt.id) ? items.map((h) => (h.id === hunt.id ? hunt : h)) : [...items, hunt];
    });
    clearWizard();
  }, [hunts, clearWizard]);

  const toggle = async (hunt: Hunt, active: boolean) => {
    try {
      await hunts.setActive(hunt.id, active);
      setSnack({ severity: 'success', text: active ? t.home.updatedActive : t.home.updatedPaused });
    } catch (err) {
      setSnack({ severity: 'error', text: offerHunterErrorMessage(err) });
    }
  };

  const confirmRemove = async () => {
    const hunt = removing;
    setRemoving(null);
    if (!hunt) return;
    try {
      await hunts.remove(hunt.id);
      setSnack({ severity: 'success', text: t.list.removed });
    } catch (err) {
      setSnack({ severity: 'error', text: offerHunterErrorMessage(err) });
    }
  };

  const createButton = (
    <Tooltip title={createTooltip} describeChild>
      <span>
        <Button
          variant="contained"
          startIcon={<AppIcon icon={Plus} size="sm" />}
          disabled={!canCreate}
          onClick={() => setWizard({ open: true, huntId: null })}
        >
          {t.list.create}
        </Button>
      </span>
    </Tooltip>
  );

  return (
    <Box>
      <PageHeader title={t.page.title} subtitle={t.page.subtitle} action={createButton} />

      {opts.errorCode && !options && (
        <Alert severity="error" sx={{ mb: 3 }} action={<Button color="inherit" size="small" onClick={() => void opts.reload()}>{t.page.retry}</Button>}>
          {t.page.loadError}
        </Alert>
      )}

      {options && (
        <HunterGatesPanel
          options={options}
          blockedBy={blockedBy}
          onOpenRisk={() => setRiskOpen(true)}
          onFocusDestination={() => destinationRef.current?.focusAndPick()}
        />
      )}

      {!planClosed && (
        <>
          <HuntUsageBar usage={usage.usage} loading={usage.loading} failed={Boolean(usage.errorCode)} />
          <HunterDestinationCard
            ref={destinationRef}
            settings={settings.settings}
            loading={settings.loading}
            sessions={sessions.sessions}
            sessionsLoading={sessions.loading}
            sessionsFailed={sessions.failed}
            onRetrySessions={() => void sessions.reload()}
            onSave={async (body) => {
              await settings.save(body);
              setSnack({ severity: 'success', text: t.destination.saved });
              void opts.reload();
            }}
          />
        </>
      )}

      <Box component="section" aria-labelledby="hunts-title">
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} sx={{ mb: 2 }}>
          <Stack direction="row" spacing={1} alignItems="baseline">
            <Typography id="hunts-title" variant="h6" component="h2" fontWeight={700}>{t.list.title}</Typography>
            {list && <Typography variant="caption" color="text.secondary">{t.list.count(list.length, huntsMax)}</Typography>}
          </Stack>
          {list && list.length > 0 && (
            <ToggleButtonGroup
              size="small"
              exclusive
              value={filter}
              onChange={(_, v: HuntFilter | null) => v && setFilter(v)}
              aria-label={t.home.filterLabel}
            >
              {(['ALL', 'ACTIVE', 'PAUSED'] as const).map((f) => (
                <ToggleButton key={f} value={f} sx={{ px: 1.5, textTransform: 'none' }}>{t.home.filters[f]}</ToggleButton>
              ))}
            </ToggleButtonGroup>
          )}
        </Stack>

        {hunts.errorCode && !list ? (
          <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void hunts.reload()}>{t.page.retry}</Button>}>
            {t.home.loadError}
          </Alert>
        ) : !list ? (
          <Box role="status" aria-label={t.page.loading} sx={gridSx}>
            <HuntCardSkeleton /><HuntCardSkeleton />
          </Box>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<AppIcon icon={Crosshair} size="lg" />}
            title={t.list.emptyTitle}
            description={t.list.emptyHint}
            sx={{ py: { xs: 5, sm: 7 }, px: { xs: 2, sm: 4 } }}
            action={(
              <Stack spacing={2.5} alignItems="center" sx={{ mt: 1 }}>
                <Paper variant="outlined" sx={{ p: 2, maxWidth: 460, textAlign: 'left', bgcolor: 'background.default' }}>
                  <Typography variant="caption" color="text.secondary" fontWeight={600} component="h3">{t.home.emptyStepsLabel}</Typography>
                  <Box component="ol" sx={{ m: 0, mt: 1, pl: 2.5, display: 'grid', gap: 0.75 }}>
                    {t.home.emptySteps.map((s) => <Typography key={s} component="li" variant="body2">{s}</Typography>)}
                  </Box>
                </Paper>
                <Tooltip title={createTooltip} describeChild>
                  <span>
                    <Button variant="contained" startIcon={<AppIcon icon={Plus} size="sm" />} disabled={!canCreate} onClick={() => setWizard({ open: true, huntId: null })}>
                      {t.home.emptyCta}
                    </Button>
                  </span>
                </Tooltip>
              </Stack>
            )}
          />
        ) : visible.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>{t.home.filterEmpty}</Typography>
        ) : (
          <Box component="ul" aria-label={t.home.listLabel} sx={{ ...gridSx, listStyle: 'none', p: 0, m: 0 }}>
            {visible.map((hunt) => (
              <Box component="li" key={hunt.id} sx={{ minWidth: 0 }}>
                <HuntCard
                  hunt={hunt}
                  options={options}
                  nowMs={now}
                  busy={hunts.busyId === hunt.id}
                  blockedReason={blockedTitle}
                  onToggle={(active) => void toggle(hunt, active)}
                  onEdit={() => setWizard({ open: true, huntId: hunt.id })}
                  onRemove={() => setRemoving(hunt)}
                />
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {options && (
        <HuntWizardDialog
          open={wizard.open && (!wizard.huntId || Boolean(editing))}
          options={options}
          hunt={editing}
          onClose={clearWizard}
          onSaved={handleSaved}
        />
      )}

      <HunterRiskNoticeDialog
        open={riskOpen}
        canAccept={canAcceptRisk}
        isSuperAdmin={isSuperAdmin}
        onClose={() => setRiskOpen(false)}
        onAccepted={() => {
          setRiskOpen(false);
          setSnack({ severity: 'success', text: t.riskNotice.accepted });
          void opts.reload();
        }}
        onStale={() => void opts.reload()}
      />

      <ConfirmDialog
        open={removing !== null}
        title={t.list.removeTitle}
        description={removing ? t.list.removeText(removing.name) : ''}
        confirmLabel={t.list.removeConfirm}
        cancelLabel={t.list.removeCancel}
        confirmColor="error"
        onConfirm={() => void confirmRemove()}
        onClose={() => setRemoving(null)}
      />

      <Snackbar open={snack !== null} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.severity} onClose={() => setSnack(null)} variant="filled">{snack.text}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}

const gridSx = {
  display: 'grid',
  gap: 2,
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))',
} as const;
