import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, InputAdornment, Snackbar, TextField, Typography } from '@mui/material';
import { GraduationCap, Search, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { AppIcon } from '@/components/AppIcon';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { useAuth } from '@/contexts/AuthContext';
import { usePersistedState } from '@/hooks/usePersistedState';
import { LESSONS, LESSON_GROUPS, isPlayable, type LessonGroup } from './catalog';
import { LessonCard } from './components/LessonCard';
import { LessonPlayerDialog } from './components/LessonPlayerDialog';
import { TrailHero, type FeaturedKind } from './components/TrailHero';
import { TrailPanel } from './components/TrailPanel';
import { pickNext, resumeAt, statsOf, statusOf, type LessonStatus } from './progress';
import { matchesQuery } from './search';
import { tutorialsStrings as t } from './strings';
import { useTutorialProgress } from './useTutorialProgress';

type StatusFilter = 'all' | LessonStatus;
type GroupFilter = 'all' | LessonGroup;
const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'new', 'inProgress', 'done'];
const PLAYABLE = LESSONS.filter(isPlayable);
const PLAYABLE_IDS = PLAYABLE.map((l) => l.id);
/** Query que abre a aula direto (`?aula=<id>`), usada pelo "copiar link". */
const LESSON_PARAM = 'aula';

const searchText = (id: string, number: string, group: LessonGroup) => {
  const c = t.lessons[id as keyof typeof t.lessons];
  return `${c.title} ${c.description} ${t.groups[group].title} ${number}`;
};

/** Central de tutoriais (Afiliados): vitrine de videoaulas com memória de assistidas. */
export function TutorialsPage() {
  const { user } = useAuth();
  // `key`: trocar de conta remonta a tela e relê o progresso da conta nova (o hook de persistência não relê ao mudar a chave)
  return <TutorialsContent key={user?.id ?? 'anon'} userId={user?.id ?? ''} />;
}

function TutorialsContent({ userId }: { userId: string }) {
  const tp = useTutorialProgress(userId);
  const [statusFilter, setStatusFilter] = usePersistedState<StatusFilter>('tutorials.filter', 'all');
  const [groupFilter, setGroupFilter] = usePersistedState<GroupFilter>('tutorials.group', 'all');
  const [query, setQuery] = usePersistedState<string>('tutorials.query', '');
  const [openId, setOpenId] = usePersistedState<string | null>('tutorials.open', null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [toast, setToast] = useState<{ text: string; severity: 'success' | 'error' } | null>(null);
  const [params, setParams] = useSearchParams();
  const searchRef = useRef<HTMLInputElement | null>(null);

  const { progress } = tp;
  const stats = useMemo(() => statsOf(PLAYABLE_IDS, progress), [progress]);
  const next = useMemo(() => pickNext(PLAYABLE_IDS, progress), [progress]);
  const allDone = stats.total > 0 && stats.done === stats.total;
  const started = PLAYABLE_IDS.some((id) => (progress[id]?.views ?? 0) > 0);

  const featuredId = allDone ? PLAYABLE_IDS[0] : next?.id ?? null;
  const featured = featuredId ? LESSONS.find((l) => l.id === featuredId) ?? null : null;
  const kind: FeaturedKind = allDone ? 'review' : !started ? 'start' : next && next.resume > 0 ? 'resume' : 'next';

  const open = useCallback((id: string) => {
    tp.view(id);
    setOpenId(id);
  }, [tp, setOpenId]);

  // Link compartilhado: `?aula=<id>` abre a aula e sai da URL (reload não reabre sozinho).
  const deepLink = params.get(LESSON_PARAM);
  useEffect(() => {
    if (!deepLink) return;
    if (PLAYABLE_IDS.includes(deepLink)) open(deepLink);
    setParams((p) => { p.delete(LESSON_PARAM); return p; }, { replace: true });
  }, [deepLink, open, setParams]);

  // "/" foca a busca (fora de campos de texto)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const share = useCallback(async (id: string) => {
    const url = `${window.location.origin}${window.location.pathname}?${LESSON_PARAM}=${encodeURIComponent(id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setToast({ text: t.card.shared, severity: 'success' });
    } catch {
      setToast({ text: t.card.shareFailed, severity: 'error' });
    }
  }, []);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: LESSONS.length, new: 0, inProgress: 0, done: 0 };
    for (const l of PLAYABLE) c[statusOf(progress[l.id])] += 1;
    return c;
  }, [progress]);

  const filtering = statusFilter !== 'all' || groupFilter !== 'all' || query.trim() !== '';
  const visible = useMemo(() => LESSONS.filter((l) => {
    if (groupFilter !== 'all' && l.group !== groupFilter) return false;
    if (statusFilter !== 'all' && (!isPlayable(l) || statusOf(progress[l.id]) !== statusFilter)) return false;
    return matchesQuery(searchText(l.id, l.number, l.group), query);
  }), [groupFilter, statusFilter, query, progress]);

  const sections = LESSON_GROUPS.map((group) => ({ group, lessons: visible.filter((l) => l.group === group) })).filter((s) => s.lessons.length > 0);
  const openLesson = openId ? PLAYABLE.find((l) => l.id === openId) ?? null : null;
  const resetFilters = () => { setStatusFilter('all'); setGroupFilter('all'); setQuery(''); };

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
      <TrailHero
        lessonCount={PLAYABLE.length}
        groupCount={LESSON_GROUPS.length}
        upcoming={LESSONS.length - PLAYABLE.length}
        featured={featured}
        kind={kind}
        resumeAt={featured ? resumeAt(progress[featured.id]) : 0}
        onWatch={() => featured && open(featured.id)}
      />

      <TrailPanel stats={stats} onReset={() => setConfirmReset(true)} />

      <TextField
        inputRef={searchRef}
        fullWidth
        size="small"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t.search.placeholder}
        slotProps={{
          htmlInput: { 'aria-label': t.search.aria, 'aria-keyshortcuts': '/', title: t.search.shortcut },
          input: {
            startAdornment: <InputAdornment position="start"><AppIcon icon={Search} size="md" /></InputAdornment>,
            endAdornment: query ? (
              <InputAdornment position="end">
                <Button size="small" color="inherit" aria-label={t.search.clear} onClick={() => setQuery('')} sx={{ minWidth: 0, p: 0.5 }}><AppIcon icon={X} size="md" /></Button>
              </InputAdornment>
            ) : undefined,
          },
        }}
        sx={{ mb: 2, '& .MuiOutlinedInput-root': { borderRadius: 999, bgcolor: 'background.paper' } }}
      />

      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, mb: 1 }}>
        <Box role="group" aria-label={t.filters.aria} sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {STATUS_FILTERS.map((f) => (
            <Chip key={f} clickable aria-pressed={statusFilter === f} onClick={() => setStatusFilter(f)}
              color={statusFilter === f ? 'primary' : 'default'} variant={statusFilter === f ? 'filled' : 'outlined'}
              label={`${t.filters[f]} · ${counts[f]}`} sx={{ fontWeight: 600, height: 36, borderRadius: '18px' }} />
          ))}
        </Box>
        <Box role="group" aria-label={t.filters.groupsAria} sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {(['all', ...LESSON_GROUPS] as const).map((g) => (
            <Chip key={g} clickable aria-pressed={groupFilter === g} onClick={() => setGroupFilter(g)}
              color={groupFilter === g ? 'secondary' : 'default'} variant={groupFilter === g ? 'filled' : 'outlined'}
              label={g === 'all' ? t.filters.allGroups : t.groups[g].title} sx={{ fontWeight: 600, height: 36, borderRadius: '18px' }} />
          ))}
        </Box>
      </Box>
      <Typography variant="caption" color="text.secondary" role="status" sx={{ display: 'block', mb: 3 }}>{t.search.count(visible.length)}</Typography>

      {sections.length === 0 ? (
        <EmptyState
          icon={<AppIcon icon={GraduationCap} size="lg" />}
          title={t.empty.title}
          description={t.empty.text}
          action={filtering ? <Button variant="outlined" onClick={resetFilters}>{t.empty.reset}</Button> : undefined}
        />
      ) : (
        sections.map(({ group, lessons }) => (
          <Box key={group} component="section" sx={{ mb: 4 }}>
            <Typography variant="h6" component="h2" sx={{ fontWeight: 800 }}>{t.groups[group].title}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t.groups[group].hint}</Typography>
            <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' } }}>
              {lessons.map((lesson) => (
                <LessonCard key={lesson.id} lesson={lesson} progress={progress[lesson.id]} onOpen={open} onToggleDone={tp.toggleDone} onShare={share} />
              ))}
            </Box>
          </Box>
        ))
      )}

      <LessonPlayerDialog
        lesson={openLesson}
        playable={PLAYABLE}
        progress={openLesson ? progress[openLesson.id] : undefined}
        onClose={() => setOpenId(null)}
        onNavigate={open}
        onToggleDone={tp.toggleDone}
        onPlayback={tp.playback}
        onEnded={tp.finish}
      />

      <ConfirmDialog
        open={confirmReset}
        title={t.resetConfirm.title}
        description={t.resetConfirm.text}
        confirmLabel={t.resetConfirm.confirm}
        cancelLabel={t.resetConfirm.cancel}
        confirmColor="error"
        onConfirm={() => { tp.reset(); setConfirmReset(false); }}
        onClose={() => setConfirmReset(false)}
      />

      <Snackbar open={toast !== null} autoHideDuration={2500} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={toast?.severity ?? 'success'} variant="filled" onClose={() => setToast(null)}>{toast?.text}</Alert>
      </Snackbar>
    </Box>
  );
}
