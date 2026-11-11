import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Snackbar } from '@mui/material';
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
import { returnButtonLabel } from '@/features/settings/utils/returnButtonLabel';

const t = settingsStrings.affiliate;

export function AffiliateCredentialsPage() {
  const {
    entries, loading, loadError, reload, refreshSilently, busy, upsert, remove, setStatus, setIdentifiers, actionError,
    clearActionError,
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
            {returnButtonLabel(returnToRef.current)}
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
              // Travado por plano = indisponível; ativa = configurado; inativa = pausado; sem credencial = pendente
              status: availability?.enabled === false ? 'locked' : !item ? 'pending' : item.status === 'ACTIVE' ? 'done' : 'paused',
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
                  // Sincronizado pela extensão (ML): primeiro a rota do marketplace (revoga o consentimento
                  // e limpa a sessão, mas mantém a linha), depois o DELETE genérico apaga a credencial.
                  // Só o DELETE deixaria a extensão recriar no próximo sync; só a rota deixaria o card.
                  onRemove={() => {
                    const marketplace = spec.usesBrowserSession ? spec.extensionMarketplace : undefined;
                    void remove(spec.provider, marketplace ? () => disconnectExt(marketplace) : undefined);
                  }}
                  onStatusChange={(status) => void setStatus(spec.provider, status)}
                />
              ),
            }))}
            renderGrid={(items) => (
              // Colunas pela largura da área de conteúdo (container query), não da janela: com o menu
              // aberto em 100% de zoom (~1170 px úteis) os 4 cards cabem numa linha.
              <Box sx={{ containerType: 'inline-size' }}>
                <Box
                  sx={{
                    display: 'grid',
                    gap: 3,
                    gridTemplateColumns: '1fr',
                    '@container (min-width: 600px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
                    '@container (min-width: 1080px)': { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' },
                    '& > *': { display: 'flex', '& > *': { flexGrow: 1 } },
                  }}
                >
                  {items.map((card) => (
                    <Box key={card.key}>{card.content}</Box>
                  ))}
                </Box>
              </Box>
            )}
          />
        </>
      )}

      {editingEntry && (
        editingEntry.spec.usesBrowserSession ? (
          <BrowserSessionCredentialDialog
            open
            spec={editingEntry.spec}
            item={editingEntry.item}
            onSaveIdentifiers={(body) => setIdentifiers(editingEntry.spec.provider, body)}
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
