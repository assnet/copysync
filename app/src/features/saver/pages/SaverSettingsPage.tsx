import { useMemo, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Skeleton, Snackbar, Stack, Typography } from '@mui/material';
import { Lock, Save, Undo2 } from 'lucide-react';
import { AppIcon, PageHeader, SectionCard } from '@/components';
import { useTenant } from '@/contexts/TenantContext';
import { usePersistedState } from '@/hooks/usePersistedState';
import { SaverDefaultsForm } from '../components/SaverDefaultsForm';
import { SaverExportGrantsSection } from '../components/SaverExportGrantsSection';
import { useSaverConfig, useSaverExportGrants, useSaverOverview } from '../hooks';
import { saverStrings as s } from '../strings';
import { SAVER_PREFIX_MAX, type SaverConfig, type UpdateSaverConfigInput } from '../types';

type Draft = Partial<SaverConfig>;

/** Só os campos do rascunho que diferem do salvo; prefixo vazio vira `null`. */
export function saverConfigChanges(saved: SaverConfig, draft: Draft): UpdateSaverConfigInput {
  const out: UpdateSaverConfigInput = {};
  if (draft.namePrefix !== undefined) {
    const prefix = draft.namePrefix?.trim() || null;
    if (prefix !== saved.namePrefix) out.namePrefix = prefix;
  }
  if (draft.excludeAdminsByDefault !== undefined && draft.excludeAdminsByDefault !== saved.excludeAdminsByDefault) {
    out.excludeAdminsByDefault = draft.excludeAdminsByDefault;
  }
  if (draft.defaultFormat !== undefined && draft.defaultFormat !== saved.defaultFormat) out.defaultFormat = draft.defaultFormat;
  if (draft.autoRefresh !== undefined && draft.autoRefresh !== saved.autoRefresh) out.autoRefresh = draft.autoRefresh;
  return out;
}

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Configurações do Saver: padrões da exportação e "Quem pode exportar". `ADMIN` edita (rascunho em
 * `usePersistedState`, limpo ao salvar); `OPERATOR` vê os padrões do `overview` só para leitura e
 * não vê a seção de liberação. Permissões vêm da API (`overview.permissions.configure`).
 */
export function SaverSettingsPage() {
  const { activeTenantId } = useTenant();
  const overview = useSaverOverview();
  const canConfigure = overview.data?.permissions.configure === true;
  const config = useSaverConfig(canConfigure);
  const grants = useSaverExportGrants(canConfigure);
  const [draft, setDraft, clearDraft] = usePersistedState<Draft>(`saver.settings.draft.${activeTenantId ?? ''}`, {});
  const [savedToast, setSavedToast] = useState(false);
  const t = s.settings;

  const saved: SaverConfig | null = canConfigure ? config.data : overview.data?.config ?? null;
  const autoRefreshAvailable = canConfigure ? config.data?.autoRefreshAvailable ?? false : overview.data?.autoRefreshEnabled ?? false;
  const value = useMemo<SaverConfig | null>(
    () => (saved ? (canConfigure ? { ...saved, ...draft } : saved) : null),
    [saved, draft, canConfigure],
  );
  const changes = saved && canConfigure ? saverConfigChanges(saved, draft) : {};
  const dirty = Object.keys(changes).length > 0;
  const prefixTooLong = (value?.namePrefix ?? '').length > SAVER_PREFIX_MAX;

  const handleSave = async () => {
    if (!dirty || prefixTooLong) return;
    if (await config.save(changes)) {
      clearDraft();
      setSavedToast(true);
    }
  };

  const loading = overview.loading || (canConfigure && config.loading && !config.data);
  const loadError = overview.error ?? (canConfigure ? config.error : null);

  return (
    <Box>
      <PageHeader title={s.pages.settings.title} subtitle={s.pages.settings.subtitle} />

      {loading ? (
        <Stack spacing={2} aria-busy="true" aria-label={t.loading}>
          <Skeleton variant="rounded" height={320} />
          <Skeleton variant="rounded" height={160} />
        </Stack>
      ) : loadError || !value ? (
        <Alert
          severity="error"
          action={<Button color="inherit" size="small" onClick={() => { void overview.reload(); if (canConfigure) void config.reload(); }}>{t.retry}</Button>}
        >
          {loadError?.message ?? t.loadError}
        </Alert>
      ) : (
        <Stack spacing={3}>
          {!canConfigure && (
            <Alert severity="info" icon={<AppIcon icon={Lock} size="sm" />}>{t.readOnly}</Alert>
          )}

          <SectionCard title={t.defaults.title} subtitle={t.defaults.subtitle}>
            <SaverDefaultsForm
              value={value}
              readOnly={!canConfigure}
              autoRefreshAvailable={autoRefreshAvailable}
              onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            />

            {canConfigure && (
              <Box sx={{ mt: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
                <Typography variant="caption" color={dirty ? 'warning.main' : 'text.secondary'} role="status">
                  {dirty ? t.unsaved : config.data?.updatedAt ? t.lastSaved(formatWhen(config.data.updatedAt)) : t.neverSaved}
                </Typography>
                <Stack direction="row" spacing={1}>
                  {dirty && (
                    <Button variant="text" onClick={clearDraft} disabled={config.saving} startIcon={<AppIcon icon={Undo2} size="inline" />}>
                      {t.discard}
                    </Button>
                  )}
                  <Button
                    variant="contained"
                    onClick={() => void handleSave()}
                    disabled={!dirty || prefixTooLong || config.saving}
                    startIcon={config.saving ? <CircularProgress size={16} color="inherit" /> : <AppIcon icon={Save} size="inline" />}
                  >
                    {config.saving ? t.saving : t.save}
                  </Button>
                </Stack>
              </Box>
            )}
            {config.saveError && <Alert severity="error" sx={{ mt: 2 }}>{config.saveError.message}</Alert>}
          </SectionCard>

          {canConfigure && <SaverExportGrantsSection grants={grants} />}
        </Stack>
      )}

      <Snackbar
        open={savedToast}
        autoHideDuration={4000}
        onClose={() => setSavedToast(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" variant="filled" onClose={() => setSavedToast(false)}>{t.saved}</Alert>
      </Snackbar>
    </Box>
  );
}
