import { useState, useCallback } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogContent, DialogTitle,
  IconButton, Stack, Tooltip, Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SyncIcon from '@mui/icons-material/Sync';
import SettingsIcon from '@mui/icons-material/Settings';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useExtension, syncErrorMessage } from '@/features/extension/hooks/useExtension';
import { ExtensionSetupWizard } from '@/features/extension/components/ExtensionSetupWizard';
import { extensionStrings } from '@/features/extension/strings';
import { useNavigate } from 'react-router-dom';
import type { AffiliateProviderSpec } from '../affiliateProviders';
import { settingsStrings } from '../strings';

const t = settingsStrings.affiliate;
const te = extensionStrings;

interface Props {
  open: boolean;
  spec: AffiliateProviderSpec;
  onClose: () => void;
}

/**
 * Diálogo de configuração para marketplaces que usam sessão de navegador (Mercado Livre).
 * Substitui o AffiliateCredentialDialog genérico: embute o wizard da extensão e exibe
 * status de sincronização ML ao invés do campo de etiqueta manual.
 */
export function BrowserSessionCredentialDialog({ open, spec, onClose }: Props) {
  const ext = useExtension();
  const navigate = useNavigate();
  const [wizardDone, setWizardDone] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      await ext.syncMl();
    } catch (err) {
      setSyncError(syncErrorMessage(err));
    } finally {
      setSyncing(false);
    }
  }, [ext]);

  const isConnected = ext.status === 'connected';
  const hasSession = !!ext.mlCredential?.lastSyncAt;
  const tag = ext.mlCredential?.publicIdentifier;

  const title = t.dialogCreateTitle(spec.name);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="browser-session-credential-dialog-title"
    >
      <DialogTitle
        id="browser-session-credential-dialog-title"
        sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        {title}
        <Tooltip title={t.closeDialog}>
          <IconButton onClick={onClose} size="small" aria-label={t.closeDialog}>
            <CloseIcon />
          </IconButton>
        </Tooltip>
      </DialogTitle>

      <DialogContent sx={{ pb: 3 }}>
        {/* Extension not connected yet — show wizard */}
        {!isConnected && !wizardDone ? (
          <ExtensionSetupWizard onComplete={() => { setWizardDone(true); void ext.refresh(); }} />
        ) : (
          <Stack spacing={2.5}>
            {/* Connected state */}
            <Alert severity="success" icon={<CheckCircleIcon />}>
              {te.settings.statusConnected}
              {ext.handshake?.extVersion && ` — v${ext.handshake.extVersion}`}
            </Alert>

            {/* ML sync status */}
            <Box
              sx={{
                p: 2, borderRadius: 1, border: 1, borderColor: 'divider',
                display: 'flex', flexDirection: 'column', gap: 1.5,
              }}
            >
              <Row label={te.ml.statusLabel}>
                {ext.mlStatus?.loggedIn ? (
                  <Chip label={te.ml.statusLoggedIn} color="success" size="small" variant="outlined" />
                ) : (
                  <Chip label={te.ml.statusLoggedOut} color="default" size="small" variant="outlined" />
                )}
              </Row>

              <Row label={te.ml.lastSyncLabel}>
                <Typography variant="body2">
                  {hasSession ? te.ml.lastSync(ext.mlCredential!.lastSyncAt!) : te.ml.statusNeverSynced}
                </Typography>
              </Row>

              <Row label={te.ml.tagLabel}>
                <Typography variant="body2" fontFamily="monospace">
                  {tag ?? te.ml.tagMissing}
                </Typography>
              </Row>
            </Box>

            {/* Sync / resync button */}
            {!hasSession && (
              <Alert severity="info" variant="outlined" sx={{ py: 0 }}>
                {t.sessionMissing}
              </Alert>
            )}

            {syncError && (
              <Alert severity="error" onClose={() => setSyncError(null)}>
                {syncError}
              </Alert>
            )}

            <Stack direction="row" spacing={1.5}>
              <Button
                variant="contained"
                disableElevation
                size="small"
                startIcon={<SyncIcon />}
                disabled={syncing}
                onClick={() => void handleSync()}
              >
                {syncing ? te.ml.syncing : te.ml.syncNow}
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<SettingsIcon />}
                onClick={() => { onClose(); navigate('/settings/extension'); }}
              >
                {te.settings.title}
              </Button>
            </Stack>
          </Stack>
        )}
      </DialogContent>
    </Dialog>
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
