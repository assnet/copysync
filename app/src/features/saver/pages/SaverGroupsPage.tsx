import { useTenant } from '@/contexts/TenantContext';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AlertTitle, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { Download, EyeOff, MessageCircleOff, Plus, RefreshCw, UsersRound, WifiOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppIcon, ConfirmDialog, EmptyState, PageHeader, SectionCard } from '@/components';
import { channelOf } from '@/features/sessions/utils';
import { usePersistedState } from '@/hooks/usePersistedState';
import { saverService } from '@/services/saver.service';
import { describeSaverError, type SaverError } from '../errors';
import { useSaverExtraction, useSaverGroups, useSaverOverview, useSaverSessionGroups, useSaverSessions } from '../hooks';
import { saverStrings as s } from '../strings';
import type { SaverExtraction, SaverGroup } from '../types';
import { sumSelectedMembers } from '../groupMembers';
import { GROUP_PAGE_SIZE, pruneSelection, visibleGroups, type GroupFilter, type GroupSort } from '../groupList';
import { SelectionActionBar } from '../components/groups/SelectionActionBar';
import { ExtractionProgress } from '../components/groups/ExtractionProgress';
import { GroupSelectionTable } from '../components/groups/GroupSelectionTable';
import { SavedGroupsTable } from '../components/groups/SavedGroupsTable';
import { SaverLimitBanner, SaverNoPlanNotice, SaverPilotNotice, limitBannerMessage, saverWithoutPlan } from '../components/groups/SaverLimitBanner';
import { SaverUsageStrip } from '../components/groups/SaverUsageStrip';
import { SessionPicker } from '../components/groups/SessionPicker';
import { ExportDialog } from '../components/export/ExportDialog';

/** Teto de grupos por pedido (API: `SAVER_MAX_GROUPS_PER_REQUEST`). */
export const SAVER_MAX_GROUPS_PER_REQUEST = 50;
export const SAVER_SESSIONS_PATH = '/settings/sessions';
export const SAVER_CONNECT_PATH = '/settings/sessions?create=1&returnTo=/saver';

const g = s.groups;
const KEY_BASE = 'saver.groups';

/** Grupos do Saver: escolher sessão, marcar grupos, acompanhar a leitura e ver os grupos salvos (só contagens). */
export function SaverGroupsPage() {
  const navigate = useNavigate();
  // Estado de trabalho por conta: sessão, seleção e extração de uma conta nunca valem em outra.
  const { activeTenantId } = useTenant();
  const KEY = `${KEY_BASE}.${activeTenantId ?? 'none'}`;
  const overview = useSaverOverview();
  const sessions = useSaverSessions();
  const saved = useSaverGroups();

  const [sessionId, setSessionId] = usePersistedState<string | null>(`${KEY}.session`, null);
  const [selection, setSelection, clearSelection] = usePersistedState<string[]>(`${KEY}.selection`, []);
  const [search, setSearch, clearSearch] = usePersistedState(`${KEY}.search`, '');
  const [filter, setFilter] = usePersistedState<GroupFilter>(`${KEY}.filter`, 'all');
  const [sort, setSort] = usePersistedState<GroupSort>(`${KEY}.sort`, 'name');
  const [shown, setShown, clearShown] = usePersistedState(`${KEY}.shown`, GROUP_PAGE_SIZE);
  const [extractionId, setExtractionId, clearExtractionId] = usePersistedState<string | null>(`${KEY}.extraction`, null);
  const [seed, setSeed] = useState<SaverExtraction | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<SaverError | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [removing, setRemoving] = useState<SaverGroup | null>(null);
  const [exportIds, setExportIds, clearExportIds] = usePersistedState<string[]>(`${KEY}.exportSelection`, []);
  const [exportOpen, setExportOpen, clearExportOpen] = usePersistedState(`${KEY}.exportOpen`, false);
  const [exported, setExported] = useState<string | null>(null);

  const progress = useSaverExtraction(extractionId, seed);
  const session = sessions.data?.find((x) => x.id === sessionId) ?? null;
  const telegram = session ? channelOf(session.engine) === 'telegram' : false;
  const offline = session !== null && !telegram && session.status !== 'CONNECTED';
  const live = useSaverSessionGroups(session && !telegram && !offline ? session.id : null);

  // Terminou a leitura: contagens, uso e marca "já salvo" mudam.
  const wasActive = useRef(false);
  const { reload: reloadOverview } = overview;
  const { reload: reloadSaved } = saved;
  const { reload: reloadLive } = live;
  useEffect(() => {
    if (wasActive.current && !progress.active) {
      void reloadOverview();
      void reloadSaved();
      void reloadLive();
    }
    wasActive.current = progress.active;
  }, [progress.active, reloadOverview, reloadSaved, reloadLive]);

  const ov = overview.data;
  const canExtract = ov?.permissions.extract ?? false;
  const canConfigure = ov?.permissions.configure ?? false;
  // Leituras fora do plano (limite 0): sem "Restam 0", sem aviso de excesso; o botão fica desligado.
  const scansExcluded = ov?.groupScansPerDay.limit === 0;
  const scansLeft = scansExcluded ? null : ov?.groupScansPerDay.remaining ?? null;
  const tooMany = selection.length > SAVER_MAX_GROUPS_PER_REQUEST;
  const selectedMembers = sumSelectedMembers(live.data ?? [], selection);
  const overScans = scansLeft !== null && selection.length > scansLeft;
  const noPlan = saverWithoutPlan(ov);
  const limitMessage = limitBannerMessage(ov, requestError?.kind === 'limitReached' ? requestError.message : null);
  const unsupported = telegram || live.error?.kind === 'unsupportedChannel';
  const disconnected = !unsupported && (offline || live.error?.kind === 'sessionNotConnected');

  const chooseSession = (id: string) => {
    if (id === sessionId) return;
    setSessionId(id);
    clearSelection();
    clearSearch();
    clearShown();
    setRequestError(null);
  };

  const submit = async () => {
    const groupJids = [...pruneSelection(selection, live.data ?? [])];
    if (!session || groupJids.length === 0) return;
    setRequesting(true);
    setRequestError(null);
    try {
      const created = await saverService.requestExtraction({ sessionId: session.id, groupJids });
      setSeed(created);
      setExtractionId(created.id);
      clearSelection();
      clearSearch();
      clearShown();
      void reloadOverview();
    } catch (err) {
      setRequestError(describeSaverError(err));
    } finally {
      setRequesting(false);
    }
  };

  const cancel = async () => {
    setCancelling(true);
    await progress.cancel();
    setCancelling(false);
  };

  const closeProgress = () => {
    clearExtractionId();
    setSeed(null);
  };

  const confirmRemove = async () => {
    const target = removing;
    setRemoving(null);
    if (target && (await saved.remove(target.id))) {
      setExportIds((ids) => ids.filter((x) => x !== target.id));
      void reloadOverview();
    }
  };

  const finishExport = (filename: string) => {
    clearExportOpen();
    clearExportIds();
    setExported(filename);
  };

  const submitDisabled = !canExtract || scansExcluded || requesting || selection.length === 0 || tooMany || overScans;
  const submitHint = !canExtract ? g.table.noExtractPermission : tooMany ? g.table.tooMany(SAVER_MAX_GROUPS_PER_REQUEST) : '';
  // Seleção salva só vale para grupos que ainda estão na sessão e podem ser lidos.
  useEffect(() => {
    if (!live.data) return;
    const pruned = pruneSelection(selection, live.data);
    if (pruned !== selection) setSelection([...pruned]);
  }, [live.data, selection, setSelection]);
  const outside = useMemo(() => {
    if (!live.data || selection.length === 0) return 0;
    const onScreen = new Set(visibleGroups(live.data, search, filter, sort, shown, g.table.untitledGroup).page.map((x) => x.groupJid));
    return selection.filter((j) => !onScreen.has(j)).length;
  }, [live.data, selection, search, filter, sort, shown]);
  const kinds = useMemo(() => new Map((live.data ?? []).map((x) => [x.groupJid, x.kind])), [live.data]);
  const hiddenTotal = (saved.data ?? []).reduce((n, x) => n + x.lidOnlyCount, 0);
  const canExport = ov?.permissions.export ?? false;
  const savedList = saved.data ?? [];
  const exportGroups = savedList.filter((x) => exportIds.includes(x.id));
  // "Todos" só por escolha explícita (nenhum grupo marcado). Marcação que não existe mais na lista não vira "todos".
  const exportAll = exportIds.length === 0;
  const staleExport = exportIds.length > 0 && saved.data !== undefined && saved.data !== null && exportGroups.length !== exportIds.length;
  useEffect(() => {
    if (staleExport) setExportIds(exportGroups.map((x) => x.id));
  }, [staleExport, exportGroups, setExportIds]);
  const exportButton = canExport && savedList.length > 0 && (exportAll || exportGroups.length > 0) && (
    <Button variant="outlined" startIcon={<AppIcon icon={Download} size="sm" />} onClick={() => { setExported(null); setExportOpen(true); }}>
      {exportAll ? g.saved.exportAll : g.saved.exportSelected(exportGroups.length)}
    </Button>
  );

  const sessionBody = () => {
    if (sessions.loading) return <Box sx={{ py: 3, textAlign: 'center' }}><CircularProgress size={28} /></Box>;
    if (sessions.error) {
      return (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void sessions.reload()}>{g.session.retry}</Button>}>
          {g.session.loadFailed}
        </Alert>
      );
    }
    if ((sessions.data ?? []).length === 0) {
      return (
        <EmptyState
          icon={<AppIcon icon={UsersRound} size="lg" />}
          title={g.session.none}
          description={g.session.noneHint}
          action={<Button variant="contained" startIcon={<AppIcon icon={Plus} size="sm" />} onClick={() => navigate(SAVER_CONNECT_PATH)}>{g.session.connect}</Button>}
        />
      );
    }
    return (
      <Stack spacing={2}>
        <SessionPicker sessions={sessions.data ?? []} value={session?.id ?? null} onChange={chooseSession} />
        {!session && <Typography color="text.secondary">{g.session.pick}</Typography>}
        {unsupported && (
          <Alert severity="info" icon={<AppIcon icon={MessageCircleOff} size="md" />}>{g.session.telegramOnly}</Alert>
        )}
        {disconnected && (
          <Alert
            severity="warning"
            icon={<AppIcon icon={WifiOff} size="md" />}
            action={<Button color="inherit" size="small" startIcon={<AppIcon icon={RefreshCw} size="sm" />} onClick={() => navigate(SAVER_SESSIONS_PATH)}>{g.session.reconnect}</Button>}
          >
            <AlertTitle>{g.session.disconnectedTitle}</AlertTitle>
            {g.session.disconnectedHint}
          </Alert>
        )}
        {session && !unsupported && !disconnected && live.loading && <Box sx={{ py: 3, textAlign: 'center' }}><CircularProgress size={28} /></Box>}
        {live.error && !unsupported && !disconnected && (
          <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void live.reload()}>{g.session.retry}</Button>}>{live.error.message}</Alert>
        )}
        {live.data && !unsupported && !disconnected && (
          <>
            <GroupSelectionTable
              groups={live.data}
              selected={selection}
              onSelectedChange={(jids) => { setSelection(jids); setRequestError(null); }}
              search={search}
              onSearchChange={setSearch}
              filter={filter}
              onFilterChange={setFilter}
              sort={sort}
              onSortChange={setSort}
              shown={shown}
              onShownChange={setShown}
              disabled={!canExtract || requesting}
            />
            {requestError && requestError.kind !== 'limitReached' && <Alert severity="error">{requestError.message}</Alert>}
            {overScans && scansLeft !== null && <Alert severity="warning">{g.table.overScans(scansLeft)}</Alert>}
            <SelectionActionBar
              count={selection.length}
              max={SAVER_MAX_GROUPS_PER_REQUEST}
              tooMany={tooMany}
              members={selectedMembers}
              scansLeft={scansLeft}
              outside={outside}
              requesting={requesting}
              submitDisabled={submitDisabled}
              submitHint={submitHint}
              onClear={clearSelection}
              onSubmit={() => void submit()}
            />
          </>
        )}
      </Stack>
    );
  };

  return (
    <Box>
      <PageHeader title={s.pages.groups.title} subtitle={s.pages.groups.subtitle} />
      <Stack spacing={2.5}>
        {overview.error && <Alert severity="error">{overview.error.message}</Alert>}
        {ov?.pilot && <SaverPilotNotice />}
        {noPlan ? <SaverNoPlanNotice /> : ov && <SaverUsageStrip overview={ov} />}
        {limitMessage && !noPlan && <SaverLimitBanner message={limitMessage} />}
        {ov && !ov.queueRunning && <Alert severity="info">{g.queueStopped}</Alert>}

        {progress.extraction && (
          <ExtractionProgress extraction={progress.extraction} onCancel={() => void cancel()} onClose={closeProgress} cancelling={cancelling} />
        )}
        {progress.error && <Alert severity="error">{progress.error.message}</Alert>}

        {/* Sem `overflow: hidden` do Card: a barra de ações sticky precisa da rolagem da página. */}
        <SectionCard title={g.session.title} sx={{ overflow: 'visible' }}>{sessionBody()}</SectionCard>

        <SectionCard title={g.saved.title} subtitle={g.saved.subtitle} action={exportButton || undefined}>
          {exported && <Alert severity="success" onClose={() => setExported(null)} sx={{ mb: 1.5 }}>{s.exportDialog.done(exported)}</Alert>}
          {saved.loading && !saved.data && <Box sx={{ py: 3, textAlign: 'center' }}><CircularProgress size={28} /></Box>}
          {saved.error && <Alert severity="error">{g.saved.loadFailed}</Alert>}
          {saved.actionError && <Alert severity="error" onClose={saved.clearActionError} sx={{ mb: 1.5 }}>{saved.actionError.message}</Alert>}
          {saved.data && saved.data.length === 0 && (
            <EmptyState icon={<AppIcon icon={UsersRound} size="lg" />} title={g.saved.empty} description={g.saved.emptyHint} />
          )}
          {saved.data && saved.data.length > 0 && (
            <Stack spacing={1.5}>
              {hiddenTotal > 0 && (
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, color: 'text.secondary' }}>
                  <Box component="span" sx={{ display: 'inline-flex', color: 'info.main', mt: '2px' }}><AppIcon icon={EyeOff} size="sm" /></Box>
                  <Typography variant="caption">{g.saved.hiddenNotice(hiddenTotal)}</Typography>
                </Box>
              )}
              <SavedGroupsTable
                groups={saved.data}
                selected={exportIds}
                onSelectedChange={setExportIds}
                selectable={canExport}
                onRemove={canConfigure ? setRemoving : undefined}
                kinds={kinds}
              />
            </Stack>
          )}
        </SectionCard>
      </Stack>

      {exportOpen && ov && (
        <ExportDialog
          open
          groups={exportAll ? savedList : exportGroups}
          all={exportAll}
          defaults={ov.config}
          onClose={clearExportOpen}
          onDone={finishExport}
        />
      )}

      <ConfirmDialog
        open={removing !== null}
        title={g.saved.removeTitle}
        description={g.saved.removeBody}
        confirmLabel={g.saved.removeConfirm}
        cancelLabel={g.saved.removeCancel}
        confirmColor="error"
        onConfirm={() => void confirmRemove()}
        onClose={() => setRemoving(null)}
      />
    </Box>
  );
}
