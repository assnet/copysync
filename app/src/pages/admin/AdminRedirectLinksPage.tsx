import { useState } from 'react';
import { Alert, Box, Button, CircularProgress, Snackbar } from '@mui/material';
import { Plus, Signpost } from 'lucide-react';
import { AppIcon, ConfirmDialog, EmptyState, PageHeader, SectionCard } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import { RedirectLinkDialog } from '@/features/redirectLinks/components/RedirectLinkDialog';
import { RedirectLinksTable } from '@/features/redirectLinks/components/RedirectLinksTable';
import { useAdminRedirectLinks } from '@/features/redirectLinks/hooks/useAdminRedirectLinks';
import { publicRedirectUrl } from '@/features/redirectLinks/rules';
import { redirectLinksStrings } from '@/features/redirectLinks/strings';
import type { RedirectLink } from '@/features/redirectLinks/types';

const t = redirectLinksStrings;

/** Diálogo aberto sobrevive a reload; o link em edição é relido da API pelo id. */
type DialogState = { mode: 'create' } | { mode: 'edit'; id: string } | null;

/** Super admin: links de redirecionamento da plataforma (`/redirect/<slug>`). */
export function AdminRedirectLinksPage() {
  const rl = useAdminRedirectLinks();
  const [dialog, setDialog, clearDialog] = usePersistedState<DialogState>('redirectLinks.dialog', null);
  const [removing, setRemoving] = useState<RedirectLink | null>(null);
  const [notice, setNotice] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);

  const editing = dialog?.mode === 'edit' ? rl.links.find((l) => l.id === dialog.id) : undefined;
  const dialogReady = dialog?.mode === 'create' || Boolean(editing);

  const copy = async (l: RedirectLink) => {
    try {
      await navigator.clipboard.writeText(publicRedirectUrl(l.slug));
      setNotice({ severity: 'success', text: t.copied });
    } catch {
      setNotice({ severity: 'error', text: t.copyFailed });
    }
  };

  return (
    <Box>
      <PageHeader title={t.pageTitle} subtitle={t.pageSubtitle} />

      {rl.loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress aria-label={t.pageTitle} />
        </Box>
      ) : rl.loadError ? (
        <Alert
          severity="error"
          action={<Button color="inherit" size="small" onClick={() => void rl.reload()}>{t.retry}</Button>}
        >
          {rl.loadError}
        </Alert>
      ) : (
        <SectionCard
          title={t.listTitle}
          noPadding={rl.links.length > 0}
          action={(
            <Button
              variant="contained"
              disableElevation
              startIcon={<AppIcon icon={Plus} size="sm" />}
              onClick={() => setDialog({ mode: 'create' })}
            >
              {t.add}
            </Button>
          )}
        >
          {rl.links.length === 0 ? (
            <EmptyState icon={<AppIcon icon={Signpost} size="lg" />} title={t.empty} description={t.emptyHint} sx={{ py: 5 }} />
          ) : (
            <RedirectLinksTable
              links={rl.links}
              busy={rl.busy}
              onToggle={(l, v) => void rl.setActive(l.id, v)}
              onCopy={(l) => void copy(l)}
              onEdit={(l) => setDialog({ mode: 'edit', id: l.id })}
              onRemove={setRemoving}
            />
          )}
        </SectionCard>
      )}

      {!rl.loading && dialogReady && (
        <RedirectLinkDialog
          key={editing?.id ?? 'new'}
          link={editing}
          onCreate={rl.create}
          onUpdate={rl.update}
          onClose={clearDialog}
        />
      )}

      <ConfirmDialog
        open={removing !== null}
        title={t.removeDialog.title}
        description={removing ? t.removeDialog.description(removing.slug) : ''}
        confirmLabel={t.removeDialog.confirm}
        cancelLabel={t.removeDialog.cancel}
        confirmColor="error"
        onConfirm={() => {
          if (removing) void rl.remove(removing.id);
          setRemoving(null);
        }}
        onClose={() => setRemoving(null)}
      />

      <Snackbar
        open={Boolean(rl.actionError)}
        autoHideDuration={6000}
        onClose={rl.clearActionError}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" variant="filled" onClose={rl.clearActionError}>{rl.actionError}</Alert>
      </Snackbar>
      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={4000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={notice?.severity ?? 'success'} variant="filled" onClose={() => setNotice(null)}>{notice?.text}</Alert>
      </Snackbar>
    </Box>
  );
}
