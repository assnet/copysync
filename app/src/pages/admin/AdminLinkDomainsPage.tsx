import { useState } from 'react';
import { Alert, Box, Button, CircularProgress, Snackbar } from '@mui/material';
import { Globe, Plus } from 'lucide-react';
import { AppIcon, ConfirmDialog, EmptyState, PageHeader, SectionCard } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import { DnsSetupGuide } from '@/features/linkDomainsAdmin/components/DnsSetupGuide';
import { LinkDomainDialog } from '@/features/linkDomainsAdmin/components/LinkDomainDialog';
import { LinkDomainsTable } from '@/features/linkDomainsAdmin/components/LinkDomainsTable';
import { useAdminLinkDomains } from '@/features/linkDomainsAdmin/hooks/useAdminLinkDomains';
import { linkDomainsAdminStrings } from '@/features/linkDomainsAdmin/strings';
import type { LinkDomain } from '@/features/linkDomainsAdmin/types';

const t = linkDomainsAdminStrings;

/** Diálogo aberto sobrevive a reload; o domínio em edição é relido da API pelo id. */
type DialogState = { mode: 'create' } | { mode: 'edit'; id: string } | null;

export function AdminLinkDomainsPage() {
  const ld = useAdminLinkDomains();
  const [dialog, setDialog, clearDialog] = usePersistedState<DialogState>('linkDomainsAdmin.dialog', null);
  const [removing, setRemoving] = useState<LinkDomain | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const editing = dialog?.mode === 'edit' ? ld.domains.find((d) => d.id === dialog.id) : undefined;
  const dialogReady = dialog?.mode === 'create' || Boolean(editing);

  const probe = async (d: LinkDomain) => {
    const result = await ld.probe(d.id);
    if (result?.ok) setNotice(t.probe.okToast(d.hostname));
  };

  return (
    <Box>
      <PageHeader title={t.pageTitle} subtitle={t.pageSubtitle} />

      {ld.loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress aria-label={t.pageTitle} />
        </Box>
      ) : ld.loadError ? (
        <Alert
          severity="error"
          action={<Button color="inherit" size="small" onClick={() => void ld.reload()}>{t.retry}</Button>}
        >
          {ld.loadError}
        </Alert>
      ) : (
        <SectionCard
          title={t.listTitle}
          noPadding={ld.domains.length > 0}
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
          {ld.domains.length === 0 ? (
            <EmptyState icon={<AppIcon icon={Globe} size="lg" />} title={t.empty} description={t.emptyHint} sx={{ py: 5 }} />
          ) : (
            <LinkDomainsTable
              domains={ld.domains}
              busy={ld.busy}
              probing={ld.probing}
              probeResults={ld.probeResults}
              onToggle={(d, v) => void ld.setActive(d.id, v)}
              onProbe={(d) => void probe(d)}
              onEdit={(d) => setDialog({ mode: 'edit', id: d.id })}
              onRemove={setRemoving}
            />
          )}
        </SectionCard>
      )}

      <DnsSetupGuide />

      {!ld.loading && dialogReady && (
        <LinkDomainDialog
          key={editing?.id ?? 'new'}
          domain={editing}
          onCreate={ld.create}
          onUpdate={ld.update}
          onClose={clearDialog}
        />
      )}

      <ConfirmDialog
        open={removing !== null}
        title={t.removeDialog.title}
        description={removing ? t.removeDialog.description(removing.hostname) : ''}
        confirmLabel={t.removeDialog.confirm}
        cancelLabel={t.removeDialog.cancel}
        confirmColor="error"
        onConfirm={() => {
          if (removing) void ld.remove(removing.id);
          setRemoving(null);
        }}
        onClose={() => setRemoving(null)}
      />

      <Snackbar
        open={Boolean(ld.actionError)}
        autoHideDuration={6000}
        onClose={ld.clearActionError}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" variant="filled" onClose={ld.clearActionError}>{ld.actionError}</Alert>
      </Snackbar>
      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={4000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" variant="filled" onClose={() => setNotice(null)}>{notice}</Alert>
      </Snackbar>
    </Box>
  );
}
