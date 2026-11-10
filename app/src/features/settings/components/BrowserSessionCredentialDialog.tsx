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
import { Blurred, useBlur } from '@/features/privacy';
import type { AffiliateProviderSpec } from '../affiliateProviders';
import { settingsStrings } from '../strings';

const t = settingsStrings.affiliate;
const te = extensionStrings;

interface Props {
  open: boolean;
  spec: AffiliateProviderSpec;
  onClose: () => void;
  /** Após cada tentativa de sync: a página recarrega o card sem esperar o diálogo fechar. */
  onSynced?: () => void;
}

/**
 * Diálogo de configuração para marketplaces que usam sessão de navegador (Mercado Livre, Shein).
 * Substitui o AffiliateCredentialDialog genérico: embute o wizard da extensão e exibe o status
 * de sincronização do marketplace do `spec`, julgado pela credencial **desse** marketplace.
 * Com `identifierFromSession` (Shein) o ID vem da sessão: só leitura, sem campo.
 */
export function BrowserSessionCredentialDialog({ open, spec, onClose, onSynced }: Props) {
  const ext = useExtension();
  const marketplace = spec.extensionMarketplace ?? 'ml';
  const isShein = marketplace === 'shein';
  const blurId = useBlur('affiliateCredentials.sessionAffiliateId');
  const navigate = useNavigate();
  const [wizardDone, setWizardDone] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      await ext.sync(marketplace);
    } catch (err) {
      setSyncError(syncErrorMessage(err, marketplace));
    } finally {
      setSyncing(false);
      onSynced?.();
    }
  }, [ext, onSynced, marketplace]);

  const isConnected = ext.status === 'connected';
  const credential = ext.credentials[marketplace];
  const hasSession = !!credential?.lastSyncAt;
  const tag = credential?.publicIdentifier;
  // Shein: sync só depois do "Conectar Shein" (aceite + permissão); aqui o botão espera o acesso.
  const sheinAccess = ext.sheinStatus?.permission === 'granted';
  const canSync = !isShein || sheinAccess;

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
        {/* Shein: o card só abre o diálogo para (re)vincular a extensão — sempre o assistente */}
        {(!isConnected || isShein) && !wizardDone ? (
          <ExtensionSetupWizard
            source="ml_wizard"
            marketplace={marketplace}
            onComplete={() => {
              setWizardDone(true);
              void ext.refresh();
              // Shein: vínculo feito, a conexão continua no card (aceite do aviso de risco).
              if (isShein) onClose();
            }}
          />
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
              {isShein ? (
                <Row label={te.shein.accessLabel}>
                  <Chip
                    label={sheinAccess ? te.shein.accessGranted : te.shein.accessMissing}
                    color={sheinAccess ? 'success' : 'default'}
                    size="small"
                    variant="outlined"
                  />
                </Row>
              ) : (
                <Row label={te.ml.statusLabel}>
                  {ext.mlStatus?.loggedIn ? (
                    <Chip label={te.ml.statusLoggedIn} color="success" size="small" variant="outlined" />
                  ) : (
                    <Chip label={te.ml.statusLoggedOut} color="default" size="small" variant="outlined" />
                  )}
                </Row>
              )}

              <Row label={te.ml.lastSyncLabel}>
                <Typography variant="body2">
                  {hasSession ? te.ml.lastSync(credential!.lastSyncAt!) : te.ml.statusNeverSynced}
                </Typography>
              </Row>

              <Row label={isShein ? te.shein.idLabel : te.ml.tagLabel}>
                {isShein ? (
                  <Blurred when={blurId} inline>
                    <Typography variant="body2" fontFamily="monospace" component="span">
                      {tag ?? te.shein.idMissing}
                    </Typography>
                  </Blurred>
                ) : (
                  <Typography variant="body2" fontFamily="monospace">
                    {tag ?? te.ml.tagMissing}
                  </Typography>
                )}
              </Row>
            </Box>

            {/* Sync / resync button */}
            {!hasSession && (
              <Alert severity="info" variant="outlined" sx={{ py: 0 }}>
                {isShein ? te.shein.accessHint : t.sessionMissing}
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
                disabled={syncing || !canSync}
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
