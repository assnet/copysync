import { useState } from 'react';
import { Alert, Box, Button, CircularProgress, Grid, Snackbar } from '@mui/material';
import { PageHeader } from '@/components';
import type { AffiliateProvider } from '@/types/api.types';
import { AffiliateCredentialCard } from '@/features/settings/components/AffiliateCredentialCard';
import { AffiliateCredentialDialog } from '@/features/settings/components/AffiliateCredentialDialog';
import { useAffiliateCredentials } from '@/features/settings/hooks/useAffiliateCredentials';
import { settingsStrings } from '@/features/settings/strings';

const t = settingsStrings.affiliate;

export function AffiliateCredentialsPage() {
  const {
    entries, loading, loadError, reload, busy, upsert, remove, setStatus, actionError, clearActionError,
  } = useAffiliateCredentials();
  const [editing, setEditing] = useState<AffiliateProvider | null>(null);
  const editingEntry = entries.find((e) => e.spec.provider === editing);

  return (
    <Box>
      <PageHeader title={t.pageTitle} subtitle={t.pageSubtitle} />

      <Alert severity="info" variant="outlined" sx={{ mb: 3 }}>{t.pageNotice}</Alert>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress aria-label={t.pageTitle} />
        </Box>
      ) : loadError ? (
        <Alert
          severity="error"
          action={<Button color="inherit" size="small" onClick={() => void reload()}>{t.retry}</Button>}
        >
          {loadError}
        </Alert>
      ) : (
        <Grid container spacing={3}>
          {entries.map(({ spec, item }) => (
            <Grid item xs={12} md={4} key={spec.provider}>
              <AffiliateCredentialCard
                spec={spec}
                item={item}
                busy={busy[spec.provider]}
                onConfigure={() => setEditing(spec.provider)}
                onRemove={() => void remove(spec.provider)}
                onStatusChange={(status) => void setStatus(spec.provider, status)}
              />
            </Grid>
          ))}
        </Grid>
      )}

      {editingEntry && (
        <AffiliateCredentialDialog
          open
          spec={editingEntry.spec}
          item={editingEntry.item}
          onClose={() => setEditing(null)}
          onSubmit={async (body) => {
            await upsert(editingEntry.spec.provider, body);
            setEditing(null);
          }}
        />
      )}

      <Snackbar
        open={Boolean(actionError)}
        autoHideDuration={6000}
        onClose={clearActionError}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" variant="filled" onClose={clearActionError}>{actionError}</Alert>
      </Snackbar>
    </Box>
  );
}
