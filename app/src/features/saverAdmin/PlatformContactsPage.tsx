import { useCallback, useEffect, useMemo, useState, type SetStateAction } from 'react';
import { Contact, Download, SearchX } from 'lucide-react';
import { Alert, Box, Button, CircularProgress, Skeleton, Snackbar, Stack, Tooltip, Typography } from '@mui/material';
import { AppIcon, EmptyState, PageHeader } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import { saverStrings } from '@/features/saver/strings';
import { saverAdminService } from '@/services/saverAdmin.service';
import { platformErrorMessage } from './errors';
import { downloadBlob } from './format';
import { PlatformContactDetailDrawer } from './PlatformContactDetailDrawer';
import { PlatformContactsFilters } from './PlatformContactsFilters';
import { PlatformContactsFooter } from './PlatformContactsFooter';
import { PlatformContactsSummary } from './PlatformContactsSummary';
import { PlatformContactsTable } from './PlatformContactsTable';
import { saverAdminStrings as s } from './strings';
import { EMPTY_PLATFORM_FILTERS, normalizePlatformFilters, type PlatformContactFilters } from './types';
import { usePlatformContacts } from './usePlatformContacts';
import { usePlatformContactsSummary } from './usePlatformContactsSummary';

/** Espera da busca antes de consultar (cada consulta vai para a auditoria). */
export const SEARCH_DEBOUNCE_MS = 400;

/**
 * Super admin: base de contatos da plataforma (SAVER-45). Filtros e contato aberto sobrevivem ao reload
 * (`usePersistedState`); a lista e os indicadores são do servidor e nunca são salvos. Os indicadores
 * carregam à parte: se falharem, a lista segue.
 */
export function PlatformContactsPage() {
  const [filters, setFilters] = usePersistedState<PlatformContactFilters>('saverAdmin.filters', EMPTY_PLATFORM_FILTERS, { version: 1 });
  /**
   * Único caminho de escrita dos filtros (campos, barras dos indicadores, "Limpar"): sempre sobre o valor mais
   * recente e sempre normalizado (DDD só com o Brasil), venha a alteração de onde vier.
   */
  const updateFilters = useCallback(
    (action: SetStateAction<PlatformContactFilters>) =>
      setFilters((prev) => normalizePlatformFilters(typeof action === 'function' ? action(prev) : action)),
    [setFilters],
  );
  const [openId, setOpenId] = usePersistedState<string | null>('saverAdmin.openContact', null);
  const [search, setSearch] = useState(filters.search);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (search === filters.search) return;
    const t = setTimeout(() => setSearch(filters.search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [filters.search, search]);

  const periodInvalid = Boolean(filters.from && filters.to && filters.from > filters.to);
  /** Filtros enviados: busca já assentada; período invertido não consulta (a API devolveria 400). */
  const applied = useMemo<PlatformContactFilters>(
    () => ({ ...filters, search, ...(periodInvalid ? { from: '', to: '' } : {}) }),
    [filters, search, periodInvalid],
  );
  const list = usePlatformContacts(applied);
  const summary = usePlatformContactsSummary(applied);
  const filtered = JSON.stringify(applied) !== JSON.stringify(EMPTY_PLATFORM_FILTERS);
  const openContact = list.items.find((c) => c.id === openId) ?? null;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const file = await saverAdminService.exportContacts(applied, s.export.fallbackName);
      downloadBlob(file.blob, file.filename);
      setToast({ severity: 'success', text: s.export.done });
    } catch (err) {
      setToast({ severity: 'error', text: platformErrorMessage(err) });
    } finally {
      setExporting(false);
    }
  };

  const exportButton = (
    <Tooltip title={s.export.hint} arrow>
      <span>
        <Button
          variant="contained"
          onClick={() => void exportCsv()}
          disabled={exporting || list.loading || list.items.length === 0}
          startIcon={exporting ? <CircularProgress size={16} color="inherit" /> : <AppIcon icon={Download} size="inline" />}
        >
          {exporting ? s.export.busy : s.export.button}
        </Button>
      </span>
    </Tooltip>
  );

  return (
    <Box>
      <PageHeader title={saverStrings.pages.platformContacts.title} subtitle={saverStrings.pages.platformContacts.subtitle} action={exportButton} />

      <Stack gap={3}>
        <PlatformContactsSummary
          state={summary}
          onPickDdi={(ddi) => updateFilters((prev) => ({ ...prev, ddi, ddd: '' }))}
          onPickDdd={(ddd) => updateFilters((prev) => ({ ...prev, ddd }))}
        />

        <PlatformContactsFilters value={filters} onChange={updateFilters} periodInvalid={periodInvalid} />

        {list.restarted && <Alert severity="info">{s.error.cursorRestarted}</Alert>}

        {list.loading && (
          <Stack gap={1} aria-busy="true">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} variant="rounded" height={44} />)}</Stack>
        )}

        {!list.loading && list.error && list.items.length === 0 && (
          <Alert severity="error" action={<Button color="inherit" size="small" onClick={list.reload}>{s.error.retry}</Button>}>
            <Typography variant="subtitle2" component="p">{s.error.title}</Typography>
            {list.error}
          </Alert>
        )}

        {!list.loading && !list.error && list.items.length === 0 && (
          filtered ? (
            <EmptyState
              icon={<AppIcon icon={SearchX} size="lg" />}
              title={s.empty.filteredTitle}
              description={s.empty.filteredDescription}
              action={<Button onClick={() => updateFilters(() => EMPTY_PLATFORM_FILTERS)}>{s.filters.clear}</Button>}
            />
          ) : (
            <EmptyState icon={<AppIcon icon={Contact} size="lg" />} title={s.empty.title} description={s.empty.description} />
          )
        )}

        {!list.loading && list.items.length > 0 && (
          <>
            <PlatformContactsTable items={list.items} onOpen={(c) => setOpenId(c.id)} />
            {list.error && (
              <Alert severity="error" action={<Button color="inherit" size="small" onClick={list.loadMore}>{s.error.retry}</Button>}>
                {list.error}
              </Alert>
            )}
            <PlatformContactsFooter
              shown={list.items.length}
              total={summary.current ? summary.data?.filtered ?? null : null}
              hasMore={Boolean(list.nextCursor)}
              loadingMore={list.loadingMore}
              onLoadMore={list.loadMore}
            />
          </>
        )}
      </Stack>

      <PlatformContactDetailDrawer contactId={openId} contact={openContact} onClose={() => setOpenId(null)} />

      <Snackbar open={toast !== null} autoHideDuration={5000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {toast ? <Alert severity={toast.severity} onClose={() => setToast(null)} variant="filled">{toast.text}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}
