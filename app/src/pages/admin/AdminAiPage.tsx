import { useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Snackbar, Stack,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import { ConfirmDialog, EmptyState, PageHeader, SectionCard } from '@/components';
import type { AiPlatformProvider, CreateAiPlatformProviderRequest } from '@/types/api.types';
import { AiModeSwitches } from '@/features/ai/components/AiModeSwitches';
import { AiProviderCard } from '@/features/ai/components/AiProviderCard';
import { AiProviderDialog } from '@/features/ai/components/AiProviderDialog';
import { useAdminAi } from '@/features/ai/hooks/useAdminAi';
import { aiStrings } from '@/features/ai/strings';

const t = aiStrings.admin;

type DialogState = { mode: 'create' } | { mode: 'edit'; provider: AiPlatformProvider } | null;

export function AdminAiPage() {
  const ai = useAdminAi();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [removing, setRemoving] = useState<AiPlatformProvider | null>(null);

  const nextPriority = ai.providers.reduce((max, p) => Math.max(max, p.priority + 1), 0);
  const noActive = ai.settings?.platformEnabled && !ai.providers.some((p) => p.enabled && p.hasKey);

  const handleSubmit = async (body: CreateAiPlatformProviderRequest) => {
    if (dialog?.mode === 'edit') {
      const { apiKey, ...rest } = body;
      await ai.update(dialog.provider.id, apiKey ? body : rest);
    } else {
      await ai.create(body);
    }
    setDialog(null);
  };

  return (
    <Box>
      <PageHeader title={t.pageTitle} subtitle={t.pageSubtitle} />

      {ai.loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress aria-label={t.pageTitle} />
        </Box>
      ) : ai.loadError || !ai.settings ? (
        <Alert
          severity="error"
          action={<Button color="inherit" size="small" onClick={() => void ai.reload()}>{t.retry}</Button>}
        >
          {ai.loadError ?? aiStrings.errors.generic}
        </Alert>
      ) : (
        <>
          <AiModeSwitches settings={ai.settings} saving={ai.savingSettings} onChange={(s) => void ai.updateSettings(s)} />

          <SectionCard
            title={t.providersTitle}
            subtitle={t.providersSubtitle}
            action={(
              <Button variant="contained" disableElevation startIcon={<AddIcon />} onClick={() => setDialog({ mode: 'create' })}>
                {t.addProvider}
              </Button>
            )}
          >
            {noActive && <Alert severity="warning" sx={{ mb: 2 }}>{t.noActiveWarning}</Alert>}
            {ai.providers.length === 0 ? (
              <EmptyState
                icon={<SmartToyOutlinedIcon />}
                title={t.emptyProviders}
                description={t.emptyProvidersHint}
                sx={{ py: 5 }}
              />
            ) : (
              <Stack spacing={1.5}>
                {ai.providers.map((p) => (
                  <AiProviderCard
                    key={p.id}
                    provider={p}
                    busy={ai.busy[p.id]}
                    testing={ai.testing[p.id]}
                    testResult={ai.testResults[p.id]}
                    onToggle={(v) => void ai.setEnabled(p.id, v)}
                    onTest={() => void ai.test(p.id)}
                    onEdit={() => setDialog({ mode: 'edit', provider: p })}
                    onRemove={() => setRemoving(p)}
                  />
                ))}
              </Stack>
            )}
          </SectionCard>
        </>
      )}

      <AiProviderDialog
        open={dialog !== null}
        provider={dialog?.mode === 'edit' ? dialog.provider : undefined}
        nextPriority={nextPriority}
        catalog={ai.catalog}
        onSubmit={handleSubmit}
        onClose={() => setDialog(null)}
      />

      <ConfirmDialog
        open={removing !== null}
        title={t.removeTitle}
        description={removing ? t.removeDescription(removing.label) : ''}
        confirmLabel={t.removeConfirm}
        cancelLabel={t.cancel}
        confirmColor="error"
        onConfirm={() => {
          if (removing) void ai.remove(removing.id);
          setRemoving(null);
        }}
        onClose={() => setRemoving(null)}
      />

      <Snackbar
        open={Boolean(ai.actionError)}
        autoHideDuration={6000}
        onClose={ai.clearActionError}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" variant="filled" onClose={ai.clearActionError}>{ai.actionError}</Alert>
      </Snackbar>
    </Box>
  );
}
