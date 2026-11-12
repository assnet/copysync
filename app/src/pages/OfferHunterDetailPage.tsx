import { useState } from 'react';
import { Alert, Box, Button, CircularProgress, Snackbar, Tab, Tabs } from '@mui/material';
import { ArrowLeft } from 'lucide-react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { AppIcon } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import { offerHunterErrorMessage, offerHunterStrings as t } from '@/features/offerHunter/strings';
import { useHuntFinds, useHuntOptions, useHuntRuns, useOfferHunt } from '@/features/offerHunter/hooks';
import { HuntDetailHeader } from '@/features/offerHunter/components/detail/HuntDetailHeader';
import { HuntFindsTab } from '@/features/offerHunter/components/detail/HuntFindsTab';
import { HuntRunsTab } from '@/features/offerHunter/components/detail/HuntRunsTab';
import { RunResultPanel } from '@/features/offerHunter/components/RunResultPanel';
import { HuntWizardDialog } from '@/features/offerHunter/components/wizard/HuntWizardDialog';

const d = t.detail;

type DetailTab = 'finds' | 'runs';
interface DetailUiState {
  tab: DetailTab;
  openFindId: string | null;
  editing: boolean;
}

/**
 * Detalhe de uma caçada (`/offer-hunter/:huntId`, sob `OfferHunterRoute`): cabeçalho com ligar/rodar/editar,
 * resultado da última busca manual, achados (aprovar/dispensar) e execuções, ambos por cursor.
 */
export function OfferHunterDetailPage() {
  const { huntId = '' } = useParams<{ huntId: string }>();
  const [ui, setUi] = usePersistedState<DetailUiState>(`offerHunter.detail.${huntId}`, { tab: 'finds', openFindId: null, editing: false }, { scope: 'tab', version: 1 });
  const huntRes = useOfferHunt(huntId);
  const { hunt, run, running, lastRun, clearLastRun, setActive, setData } = huntRes;
  const { options, blockedBy } = useHuntOptions();
  const finds = useHuntFinds(huntId);
  const runs = useHuntRuns(huntId);
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
    <Box>
      {back}
      <HuntDetailHeader
        hunt={hunt}
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
          />
        </Box>
      ) : (
        <Box role="tabpanel" id="hunt-panel-runs" aria-labelledby="hunt-tab-runs">
          <HuntRunsTab runs={runs} />
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
