import { useState } from 'react';
import { Alert, Box, Button, CircularProgress, Snackbar, Tab, Tabs } from '@mui/material';
import { ArrowLeft } from 'lucide-react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { AppIcon } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import { offerHunterErrorMessage, offerHunterStrings as t } from '@/features/offerHunter/strings';
import {
  hunterStateKey, useHuntFinds, useHuntOptions, useHuntRuns, useHunterSettings, useHunterStateScope, useOfferHunt, useRunRankings,
} from '@/features/offerHunter/hooks';
import { HuntDetailHeader } from '@/features/offerHunter/components/detail/HuntDetailHeader';
import { HuntFindsTab } from '@/features/offerHunter/components/detail/HuntFindsTab';
import { HuntRunsTab } from '@/features/offerHunter/components/detail/HuntRunsTab';
import { RunResultPanel } from '@/features/offerHunter/components/RunResultPanel';
import { HuntWizardDialog } from '@/features/offerHunter/components/wizard/HuntWizardDialog';
import { providerOf } from '@/features/offerHunter/providers';

const d = t.detail;

type DetailTab = 'finds' | 'runs';
interface DetailUiState {
  tab: DetailTab;
  openFindId: string | null;
  /** Execução com o ranking aberto (ausente em estado salvo antes = nenhuma). */
  openRunId?: string | null;
  editing: boolean;
}

/**
 * Detalhe de uma caçada (`/offer-hunter/:huntId`, sob `OfferHunterRoute`): cabeçalho com ligar/rodar/editar,
 * resultado da última busca manual, achados (aprovar/dispensar) e execuções, ambos por cursor.
 */
export function OfferHunterDetailPage() {
  // Estado da aba é por dono (tenant + usuário): remonta ao trocar
  const scope = useHunterStateScope();
  return <OfferHunterDetail key={scope} scope={scope} />;
}

function OfferHunterDetail({ scope }: { scope: string }) {
  const { huntId = '' } = useParams<{ huntId: string }>();
  const [ui, setUi] = usePersistedState<DetailUiState>(hunterStateKey(`offerHunter.detail.${huntId}`, scope), { tab: 'finds', openFindId: null, editing: false }, { scope: 'tab', version: 1 });
  const huntRes = useOfferHunt(huntId);
  const { hunt, run, running, lastRun, clearLastRun, setActive, setData } = huntRes;
  // Opções e portões da loja desta caçada (só depois de carregá-la)
  const { options, blockedBy } = useHuntOptions(hunt ? providerOf(hunt) : null);
  const finds = useHuntFinds(huntId);
  const runs = useHuntRuns(huntId);
  const rankings = useRunRankings(huntId);
  const { settings } = useHunterSettings();
  const [runError, setRunError] = useState<unknown>(null);
  const [toggling, setToggling] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);

  const back = (
    <Button component={RouterLink} to="/offer-hunter" size="small" startIcon={<AppIcon icon={ArrowLeft} size="sm" />} sx={{ mb: 2 }}>
      {t.page.back}
    </Button>
  );

  if (huntRes.loading && !hunt) {
    return <Box>{back}<Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box></Box>;
  }
  if (!hunt) {
    const msg = huntRes.errorCode && t.errors[huntRes.errorCode] ? t.errors[huntRes.errorCode] : d.loadError;
    return (
      <Box>
        {back}
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void huntRes.reload()}>{t.page.retry}</Button>}>{msg}</Alert>
      </Box>
    );
  }

  const doRun = async () => {
    setRunError(null);
    clearLastRun();
    try {
      await run();
      void finds.reload();
      void runs.reload();
    } catch (err) {
      setRunError(err);
    }
  };

  const toggle = async (active: boolean) => {
    setToggling(true);
    try {
      await setActive(active);
      setToast({ text: active ? d.updatedActive : d.updatedPaused });
    } catch (err) {
      setToast({ text: offerHunterErrorMessage(err), error: true });
    } finally {
      setToggling(false);
    }
  };

  return (
    // Folga no fim: o botão flutuante de suporte não cobre o "Reenviar" do último achado
    <Box sx={{ pb: 9 }}>
      {back}
      <HuntDetailHeader
        hunt={hunt}
        options={options}
        blockedBy={blockedBy}
        running={running}
        toggling={toggling}
        onToggle={(v) => void toggle(v)}
        onRun={() => void doRun()}
        onEdit={() => setUi((s) => ({ ...s, editing: true }))}
      />

      {(running || lastRun || runError != null) && (
        <Box sx={{ mb: 3 }}>
          <RunResultPanel
            title={d.resultTitle}
            running={running}
            result={lastRun}
            error={runError}
            provider={providerOf(hunt)}
            onClose={() => { clearLastRun(); setRunError(null); }}
          />
        </Box>
      )}

      <Tabs
        value={ui.tab}
        onChange={(_e, tab: DetailTab) => setUi((s) => ({ ...s, tab }))}
        aria-label={d.tabsLabel}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab value="finds" label={d.tabFinds} id="hunt-tab-finds" aria-controls="hunt-panel-finds" />
        <Tab value="runs" label={d.tabRuns} id="hunt-tab-runs" aria-controls="hunt-panel-runs" />
      </Tabs>

      {ui.tab === 'finds' ? (
        <Box role="tabpanel" id="hunt-panel-finds" aria-labelledby="hunt-tab-finds">
          <HuntFindsTab
            items={finds.items}
            loading={finds.loading}
            loadingMore={finds.loadingMore}
            hasMore={finds.hasMore}
            errorCode={finds.errorCode}
            busyFindId={finds.busyFindId}
            openFindId={ui.openFindId}
            onToggleOpen={(id) => setUi((s) => ({ ...s, openFindId: s.openFindId === id ? null : id }))}
            onLoadMore={() => void finds.loadMore()}
            onReload={() => void finds.reload()}
            onApprove={finds.approve}
            onDismiss={finds.dismiss}
            onRedeliver={finds.resend}
            destinationGroupName={settings?.groupName ?? null}
          />
        </Box>
      ) : (
        <Box role="tabpanel" id="hunt-panel-runs" aria-labelledby="hunt-tab-runs">
          <HuntRunsTab
            runs={runs}
            openRunId={ui.openRunId ?? null}
            onToggleRun={(id) => setUi((s) => ({ ...s, openRunId: s.openRunId === id ? null : id }))}
            rankings={rankings}
          />
        </Box>
      )}

      {options && (
        <HuntWizardDialog
          open={ui.editing}
          options={options}
          hunt={hunt}
          onClose={() => setUi((s) => ({ ...s, editing: false }))}
          onSaved={(saved) => {
            setData(saved);
            setUi((s) => ({ ...s, editing: false }));
            setToast({ text: t.wizard.saved });
          }}
        />
      )}

      <Snackbar open={toast !== null} autoHideDuration={5000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={toast?.error ? 'error' : 'success'} variant="filled" onClose={() => setToast(null)}>{toast?.text}</Alert>
      </Snackbar>
    </Box>
  );
}
