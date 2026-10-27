import { useState, useCallback } from 'react';
import { Box, Button, CircularProgress, Alert, Typography, Stack } from '@mui/material';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import { PageHeader, SectionCard, ConfirmDialog } from '@/components';
import { useExtension } from '@/features/extension/hooks/useExtension';
import { extensionStrings } from '@/features/extension/strings';
import { ExtensionStatusBadge } from '@/features/extension/components/ExtensionStatusBadge';
import { ExtensionSetupWizard } from '@/features/extension/components/ExtensionSetupWizard';
import { ExtensionMlCard } from '@/features/extension/components/ExtensionMlCard';

const ts = extensionStrings.settings;
const tw = extensionStrings.wizard;

export function ExtensionSettingsPage() {
  const ext = useExtension();
  const [showWizard, setShowWizard] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const handleRevoke = useCallback(async () => {
    setConfirmRevoke(false);
    await ext.revokeSession();
  }, [ext]);

  if (ext.loading) {
    return (
      <Box>
        <PageHeader title={ts.title} subtitle={ts.subtitle} />
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress aria-label={ts.title} />
        </Box>
      </Box>
    );
  }

  // Not detected / unavailable — install prompt
  if (ext.status === 'not_detected' || ext.status === 'unavailable') {
    return (
      <Box>
        <PageHeader title={ts.title} subtitle={ts.subtitle} />
        <Alert severity="info" variant="outlined">
          <Typography variant="body2">{ts.installHint}</Typography>
        </Alert>
      </Box>
    );
  }

  // Detected but not connected — show wizard
  if (ext.status === 'detected' || showWizard) {
    return (
      <Box>
        <PageHeader title={tw.title} />
        <ExtensionSetupWizard onComplete={() => { setShowWizard(false); void ext.refresh(); }} />
      </Box>
    );
  }

  // Connected — full settings view
  return (
    <Box>
      <PageHeader title={ts.title} subtitle={ts.subtitle} />

      <Stack spacing={3}>
        {/* Extension info card */}
        <SectionCard title={ts.statusLabel}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Row label={ts.statusLabel}>
              <ExtensionStatusBadge status={ext.status} />
            </Row>
            {ext.handshake?.extVersion && (
              <Row label={ts.versionLabel}>
                <Typography variant="body2">v{ext.handshake.extVersion}</Typography>
              </Row>
            )}
          </Box>
        </SectionCard>

        {/* ML card */}
        <ExtensionMlCard />

        {/* Disconnect extension */}
        <Box>
          <Button
            variant="outlined"
            color="error"
            size="small"
            startIcon={<LinkOffIcon />}
            onClick={() => setConfirmRevoke(true)}
          >
            {ts.disconnectExtension}
          </Button>
        </Box>
      </Stack>

      <ConfirmDialog
        open={confirmRevoke}
        title={ts.disconnectExtension}
        description={ts.disconnectConfirm}
        confirmLabel={ts.disconnectExtension}
        cancelLabel="Cancelar"
        confirmColor="error"
        onConfirm={() => void handleRevoke()}
        onClose={() => setConfirmRevoke(false)}
      />
    </Box>
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
