import { useState } from 'react';
import { Alert, Box, Button, Chip, Skeleton, Snackbar, Stack, Tooltip, Typography } from '@mui/material';
import { Link2, Plus, Smartphone } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppIcon, EmptyState, PageHeader } from '@/components';
import { PlanLimitBanner } from '@/features/linkRotation/components/PlanLimitBanner';
import { RotationCard } from '@/features/linkRotation/components/RotationCard';
import { RotationConfigDialog } from '@/features/linkRotation/components/RotationConfigDialog';
import { RotationGroupsDialog } from '@/features/linkRotation/components/RotationGroupsDialog';
import { useLinkRotationOverview } from '@/features/linkRotation/hooks/useLinkRotationOverview';
import { linkRotationStrings } from '@/features/linkRotation/strings';
import type { Rotation } from '@/features/linkRotation/types';
import { usePersistedState } from '@/hooks/usePersistedState';
import { linkRotationService } from '@/services/linkRotation.service';
import { linkRotationError } from '@/utils/linkRotationErrors';

const t = linkRotationStrings.page;
const te = linkRotationStrings.empty;

/** Diálogo aberto + rodízio em foco (persistido na aba; o rodízio é recarregado pelo id). */
type OpenDialog =
  | { kind: 'config'; rotationId: string | null }
  | { kind: 'groups'; rotationId: string }
  | { kind: 'limit'; limitKind: 'rotations' | 'groups'; limit: number };

const CONNECT_SESSION_PATH = '/settings/sessions?create=1&returnTo=/link-rotation';
const CARDS_GRID = { display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' } } as const;

export function LinkRotationPage() {
  const navigate = useNavigate();
  const { overview, loading, failed, reload, upsert } = useLinkRotationOverview();
  const [dialog, setDialog, clearDialog] = usePersistedState<OpenDialog | null>('linkRotation.dialog', null, { scope: 'tab' });
  const [toast, setToast] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);

  const rotations = overview?.rotations ?? [];
  const limit = overview?.limits.linkRotations ?? null;
  const groupLimit = overview?.limits.linkRotationGroups ?? null;
  const atLimit = limit !== null && rotations.length >= limit;
  const noDomain = overview !== null && overview.domains.length === 0;
  const noSession = overview !== null && overview.sessions.length === 0;
  const blocked = noDomain || noSession;

  const byId = (id: string | null) => (id ? rotations.find((r) => r.id === id) : undefined);
  const sessionOf = (r: Rotation) => overview?.sessions.find((s) => s.id === r.sessionId) ?? null;

  const openCreate = () => {
    if (atLimit && limit !== null) setDialog({ kind: 'limit', limitKind: 'rotations', limit });
    else setDialog({ kind: 'config', rotationId: null });
  };

  const toggleStatus = async (rotation: Rotation, next: 'ACTIVE' | 'PAUSED') => {
    try {
      upsert(await linkRotationService.update(rotation.id, { status: next }));
      setToast({ message: next === 'ACTIVE' ? linkRotationStrings.toast.activated : linkRotationStrings.toast.paused, severity: 'success' });
    } catch (err) {
      const info = linkRotationError(err);
      if (info.limitKind && info.limit !== null) setDialog({ kind: 'limit', limitKind: info.limitKind, limit: info.limit });
      else setToast({ message: info.message, severity: 'error' });
    }
  };

  const createButton = (
    <Tooltip title={atLimit ? t.limitReachedTooltip : t.createTooltip} arrow describeChild>
      <Button variant="contained" startIcon={<AppIcon icon={Plus} size="sm" />} onClick={openCreate}>
        {t.create}
      </Button>
    </Tooltip>
  );

  const configRotation = dialog?.kind === 'config' ? byId(dialog.rotationId) : undefined;
  const groupsRotation = dialog?.kind === 'groups' ? byId(dialog.rotationId) : undefined;

  return (
    <Box>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        action={
          overview && rotations.length > 0 && !blocked && (
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Chip size="small" variant="outlined" label={t.usage(rotations.length, limit)} />
              {createButton}
            </Stack>
          )
        }
      />

      {loading && !overview ? (
        <Box sx={CARDS_GRID}>{[0, 1].map((k) => <Skeleton key={k} variant="rounded" height={240} />)}</Box>
      ) : failed || !overview ? (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void reload()}>{t.retry}</Button>}>
          {t.loadError}
        </Alert>
      ) : rotations.length === 0 ? (
        <EmptyState
          icon={<AppIcon icon={Link2} size="lg" />}
          title={te.title}
          description={te.description}
          action={
            <Stack spacing={2} alignItems="center">
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="center" component="ol" sx={{ listStyle: 'none', p: 0, m: 0 }}>
                {te.steps.map((step, i) => (
                  <Chip key={step} component="li" size="small" variant="outlined" label={`${i + 1}. ${step}`} />
                ))}
              </Stack>
              {blocked ? (
                <Stack spacing={1.5} alignItems="center">
                  <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ maxWidth: 420 }}>
                    {noDomain ? te.noDomain : te.noSession}
                  </Typography>
                  {noDomain ? (
                    <Button variant="contained" disabled startIcon={<AppIcon icon={Plus} size="sm" />}>{te.cta}</Button>
                  ) : (
                    <Button variant="contained" startIcon={<AppIcon icon={Smartphone} size="sm" />} onClick={() => navigate(CONNECT_SESSION_PATH)}>
                      {te.connectSession}
                    </Button>
                  )}
                </Stack>
              ) : (
                <Button variant="contained" size="large" startIcon={<AppIcon icon={Plus} size="sm" />} onClick={openCreate}>
                  {te.cta}
                </Button>
              )}
            </Stack>
          }
        />
      ) : (
        <Box sx={CARDS_GRID}>
          {rotations.map((r) => (
            <RotationCard
              key={r.id}
              rotation={r}
              session={sessionOf(r)}
              groupLimit={groupLimit}
              onToggleStatus={(next) => toggleStatus(r, next)}
              onConfigure={() => setDialog({ kind: 'config', rotationId: r.id })}
              onManageGroups={() => setDialog({ kind: 'groups', rotationId: r.id })}
              onCopyFailed={() => setToast({ message: linkRotationStrings.card.copyFailed, severity: 'error' })}
            />
          ))}
        </Box>
      )}

      {overview && dialog?.kind === 'config' && (
        <RotationConfigDialog
          open
          onClose={clearDialog}
          rotation={configRotation}
          overview={overview}
          onSaved={(rotation) => {
            upsert(rotation);
            setToast({ message: configRotation ? linkRotationStrings.toast.saved : linkRotationStrings.toast.created, severity: 'success' });
            // Criou: segue para os grupos; editou: fecha
            if (configRotation) clearDialog();
            else setDialog({ kind: 'groups', rotationId: rotation.id });
          }}
        />
      )}

      {groupsRotation && (
        <RotationGroupsDialog
          open
          onClose={clearDialog}
          rotation={groupsRotation}
          limit={groupLimit}
          onSaved={(groups) => {
            upsert({ ...groupsRotation, groups });
            setToast({ message: linkRotationStrings.toast.groupsSaved, severity: 'success' });
            clearDialog();
          }}
        />
      )}

      {dialog?.kind === 'limit' && (
        <PlanLimitBanner open onClose={clearDialog} kind={dialog.limitKind} limit={dialog.limit} />
      )}

      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        {toast ? <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)}>{toast.message}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}
