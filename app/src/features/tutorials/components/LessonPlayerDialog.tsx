import { useEffect, useMemo, useRef } from 'react';
import { Box, Button, Dialog, IconButton, Tooltip, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, ExternalLink, X } from 'lucide-react';
import { AppIcon } from '@/components/AppIcon';
import { watchUrl, type Lesson } from '../catalog';
import { formatClock, resumeAt, type LessonProgress } from '../progress';
import { tutorialsStrings as t } from '../strings';
import { buildEmbedUrl } from '../youtubeBridge';
import { useLessonPlayer } from './useLessonPlayer';

interface Props {
  lesson: Lesson | null;
  /** Aulas reproduzíveis na ordem da trilha (navegação anterior/próxima). */
  playable: readonly Lesson[];
  progress: LessonProgress | undefined;
  onClose: () => void;
  onNavigate: (id: string) => void;
  onToggleDone: (id: string) => void;
  onPlayback: (id: string, position: number, duration: number) => void;
  onEnded: (id: string) => void;
}

export function LessonPlayerDialog({ lesson, playable, progress, onClose, onNavigate, onToggleDone, onPlayback, onEnded }: Props) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const id = lesson?.id ?? null;

  // Ponto de retomada fixado na abertura: o progresso muda durante a reprodução e não deve recarregar o iframe.
  const startRef = useRef({ id: null as string | null, at: 0 });
  if (startRef.current.id !== id) startRef.current = { id, at: resumeAt(progress) };
  const startAt = startRef.current.at;

  useLessonPlayer(frameRef, id, {
    onProgress: onPlayback,
    onEnded,
  });

  const index = useMemo(() => playable.findIndex((l) => l.id === id), [playable, id]);
  const prev = index > 0 ? playable[index - 1] : null;
  const next = index >= 0 && index < playable.length - 1 ? playable[index + 1] : null;

  // Setas ← → trocam de aula (o foco fora do iframe; dentro dele o YouTube usa as setas para buscar).
  useEffect(() => {
    if (!id) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && prev) onNavigate(prev.id);
      if (e.key === 'ArrowRight' && next) onNavigate(next.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id, prev, next, onNavigate]);

  const copy = lesson ? t.lessons[lesson.id as keyof typeof t.lessons] : null;
  const done = progress?.done === true;

  return (
    <Dialog open={Boolean(lesson)} onClose={onClose} fullWidth maxWidth="md" fullScreen={fullScreen} aria-labelledby="lesson-player-title"
      slotProps={{ paper: { sx: { borderRadius: fullScreen ? 0 : '20px', overflow: 'hidden', backgroundImage: 'none' } } }}>
      {lesson && copy && lesson.youtubeId && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, p: 2, pb: 1.5 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="caption" color="primary" sx={{ fontWeight: 700 }}>
                {t.card.lesson(lesson.number)} · {t.player.stepOf(index + 1, playable.length)}
              </Typography>
              <Typography id="lesson-player-title" variant="h6" component="h2" sx={{ lineHeight: 1.25 }}>{copy.title}</Typography>
            </Box>
            <Tooltip title={t.player.close} arrow>
              <IconButton onClick={onClose} aria-label={t.player.close} sx={{ width: 44, height: 44 }}><AppIcon icon={X} size="md" /></IconButton>
            </Tooltip>
          </Box>

          <Box sx={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', bgcolor: '#000' }}>
            <Box
              component="iframe"
              ref={frameRef}
              key={lesson.id}
              src={buildEmbedUrl(lesson.youtubeId, startAt, window.location.origin)}
              title={copy.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
            />
          </Box>

          <Box sx={{ p: 2, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}>
            <Typography variant="body2" color="text.secondary" sx={{ flex: '1 1 220px' }}>
              {startAt > 0 ? t.player.resumeNote(formatClock(startAt)) : copy.description}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              <Tooltip title={t.player.prev} arrow><span>
                <IconButton disabled={!prev} onClick={() => prev && onNavigate(prev.id)} aria-label={t.player.prev} sx={{ width: 44, height: 44 }}><AppIcon icon={ChevronLeft} size="md" /></IconButton>
              </span></Tooltip>
              <Tooltip title={t.player.next} arrow><span>
                <IconButton disabled={!next} onClick={() => next && onNavigate(next.id)} aria-label={t.player.next} sx={{ width: 44, height: 44 }}><AppIcon icon={ChevronRight} size="md" /></IconButton>
              </span></Tooltip>
              <Button
                variant={done ? 'outlined' : 'contained'}
                color={done ? 'success' : 'primary'}
                aria-pressed={done}
                onClick={() => onToggleDone(lesson.id)}
                startIcon={<AppIcon icon={done ? CheckCircle2 : Circle} size="md" />}
              >
                {done ? t.player.markUndone : t.player.markDone}
              </Button>
              <Button
                component="a" href={watchUrl(lesson.youtubeId)} target="_blank" rel="noopener noreferrer"
                startIcon={<AppIcon icon={ExternalLink} size="md" />}
              >
                {t.player.openYoutube}
              </Button>
            </Box>
          </Box>
        </>
      )}
    </Dialog>
  );
}
