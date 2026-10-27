import { useState, useCallback } from 'react';
import {
  Box, Typography, Button, Alert, Chip, Tooltip,
} from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import { SectionCard, ConfirmDialog } from '@/components';
import { useExtension } from '../hooks/useExtension';
import { extensionStrings } from '../strings';

const t = extensionStrings.ml;

export function ExtensionMlCard() {
  const ext = useExtension();
  const [syncing, setSyncing] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try { await ext.syncMl(); } finally { setSyncing(false); }
  }, [ext]);

  const handleDisconnect = useCallback(async () => {
    setConfirmDisconnect(false);
    await ext.disconnectMl();
  }, [ext]);

  const ml = ext.mlStatus;
  const cred = ext.mlCredential;
  const isExpired = !!cred?.sessionInvalidAt;

  return (
    <>
      <SectionCard
        title={t.title}
        action={
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Tooltip title={t.syncNow}>
              <span>
                <Button
                  size="small"
                  startIcon={<SyncIcon />}
                  disabled={syncing}
                  onClick={() => void handleSync()}
                >
                  {syncing ? t.syncing : t.syncNow}
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={t.disconnectMl}>
              <span>
                <Button
                  size="small"
                  color="error"
                  startIcon={<LinkOffIcon />}
                  onClick={() => setConfirmDisconnect(true)}
                >
                  {t.disconnectMl}
                </Button>
              </span>
            </Tooltip>
          </Box>
        }
      >
        {isExpired && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t.resyncHint}
          </Alert>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Row label={t.statusLabel}>
            {ml?.loggedIn ? (
              <Chip label={t.statusLoggedIn} color="success" size="small" variant="outlined" />
            ) : (
              <Chip label={t.statusLoggedOut} color="default" size="small" variant="outlined" />
            )}
          </Row>

          <Row label={t.lastSyncLabel}>
            <Typography variant="body2">
              {cred?.lastSyncAt ? t.lastSync(cred.lastSyncAt) : t.statusNeverSynced}
            </Typography>
          </Row>

          <Row label={t.tagLabel}>
            <Typography variant="body2">
              {cred?.publicIdentifier ?? t.tagMissing}
            </Typography>
          </Row>
        </Box>
      </SectionCard>

      <ConfirmDialog
        open={confirmDisconnect}
        title={t.disconnectMl}
        description={t.disconnectMlConfirm}
        confirmLabel={t.disconnectMl}
        cancelLabel="Cancelar"
        confirmColor="error"
        onConfirm={() => void handleDisconnect()}
        onClose={() => setConfirmDisconnect(false)}
      />
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 140 }}>
        {label}
      </Typography>
      {children}
    </Box>
  );
}
