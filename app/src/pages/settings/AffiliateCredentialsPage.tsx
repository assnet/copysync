import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Grid, Snackbar } from '@mui/material';
import { ArrowLeft } from 'lucide-react';
import { AppIcon, PageHeader, SwipeCards } from '@/components';
import { safeReturnPath } from '@/features/sessions/utils';
import type { AffiliateProvider } from '@/types/api.types';
import { AffiliateCredentialCard } from '@/features/settings/components/AffiliateCredentialCard';
import { AffiliateConnectionSummary } from '@/features/settings/components/AffiliateConnectionSummary';
import { AffiliateCredentialDialog } from '@/features/settings/components/AffiliateCredentialDialog';
import { BrowserSessionCredentialDialog } from '@/features/settings/components/BrowserSessionCredentialDialog';
import { SheinCredentialCard } from '@/features/settings/components/SheinCredentialCard';
import { useAffiliateCredentials } from '@/features/settings/hooks/useAffiliateCredentials';
import { useExtension } from '@/features/extension/hooks/useExtension';
import { useTenant } from '@/contexts/TenantContext';
import { settingsStrings } from '@/features/settings/strings';

const t = settingsStrings.affiliate;

export function AffiliateCredentialsPage() {
  const {
    entries, loading, loadError, reload, refreshSilently, busy, upsert, remove, setStatus, actionError, clearActionError,
  } = useAffiliateCredentials();
  const ext = useExtension();
  const { tenants, activeTenantId } = useTenant();
  // Só ADMIN confirmado aceita o aviso de risco; papel desconhecido trata como operador.
  const canAcceptRisk = tenants.find((x) => x.id === activeTenantId)?.role === 'ADMIN';
  const { refresh: refreshExt, disconnect: disconnectExt } = ext;

  /** Provider com ID da sessão (Shein): desconectar pela rota da extensão, nunca o DELETE genérico. */
  const disconnectSession = async (spec: (typeof entries)[number]['spec']) => {
    await disconnectExt(spec.extensionMarketplace ?? 'shein');
    await refreshSilently();
  };
  const [editing, setEditing] = useState<AffiliateProvider | null>(null);
  const editingEntry = entries.find((e) => e.spec.provider === editing);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // `?returnTo=/monitoring`: veio do aviso de credencial; guarda antes de limpar a URL (reload não repete)
  const returnToRef = useRef(safeReturnPath(searchParams.get('returnTo')));
  useEffect(() => {
    if (!searchParams.has('returnTo')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('returnTo');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box>
      <PageHeader
        title={t.pageTitle}
        subtitle={t.pageSubtitle}
        action={returnToRef.current ? (
          <Button variant="outlined" startIcon={<AppIcon icon={ArrowLeft} size="sm" />} onClick={() => navigate(returnToRef.current!)}>
            {t.backToMonitoring}
          </Button>
        ) : undefined}
      />

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
        <>
          <AffiliateConnectionSummary entries={entries} />
          {/* Mobile: um marketplace por deslize; sm+: grade. Diálogos de edição ficam fora (modais) */}
          <SwipeCards
            ariaLabel={t.carouselLabel}
            items={entries.map(({ spec, item, availability }) => ({
              key: spec.provider,
              label: spec.name,
              // Ativa = configurado; existe mas inativa = pausado; sem credencial = pendente
              status: !item ? 'pending' : item.status === 'ACTIVE' ? 'done' : 'paused',
              content: spec.identifierFromSession ? (
                <SheinCredentialCard
                  spec={spec}
                  item={item}
                  availability={availability}
                  ext={ext}
                  canAcceptRisk={canAcceptRisk}
                  busy={busy[spec.provider]}
                  onReload={refreshSilently}
                  onDisconnect={() => disconnectSession(spec)}
                  onStatusChange={(status) => void setStatus(spec.provider, status)}
                  onOpenLink={() => setEditing(spec.provider)}
                />
              ) : (
                <AffiliateCredentialCard
                  spec={spec}
                  item={item}
                  busy={busy[spec.provider]}
                  onConfigure={() => setEditing(spec.provider)}
                  // Provider com `identifierFromSession` sempre cai no SheinCredentialCard (desconecta lá).
                  onRemove={() => void remove(spec.provider)}
                  onStatusChange={(status) => void setStatus(spec.provider, status)}
                />
              ),
            }))}
            renderGrid={(items) => (
              <Grid container spacing={3}>
                {items.map((card) => (
                  <Grid item xs={12} md={6} xl={3} key={card.key} sx={{ display: 'flex', '& > *': { flexGrow: 1 } }}>
                    {card.content}
                  </Grid>
                ))}
              </Grid>
            )}
          />
        </>
      )}

      {editingEntry && (
        editingEntry.spec.usesBrowserSession ? (
          <BrowserSessionCredentialDialog
            open
            spec={editingEntry.spec}
            onClose={() => { setEditing(null); void refreshSilently(); void refreshExt(); }}
            onSynced={() => { void refreshSilently(); }}
          />
        ) : (
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
        )
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
