import { Box, Button, Chip, IconButton, LinearProgress, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import { CheckCircle2, Circle, Clock, Play, RotateCcw, Share2 } from 'lucide-react';
import { AppIcon } from '@/components/AppIcon';
import { isPlayable, thumbnailUrl, type Lesson } from '../catalog';
import { barRatio, formatClock, resumeAt, statusOf, type LessonProgress } from '../progress';
import { REDUCED_MOTION, THUMB_FALLBACK, THUMB_SCRIM, accentGradient } from '../style';
import { tutorialsStrings as t } from '../strings';

interface Props {
  lesson: Lesson;
  progress: LessonProgress | undefined;
  onOpen: (id: string) => void;
  onToggleDone: (id: string) => void;
  onShare: (id: string) => void;
}

/** Card de aula: capa 16:9 com barra de progresso, trilha, estado e ações (assistir, concluir, compartilhar). */
export function LessonCard({ lesson, progress, onOpen, onToggleDone, onShare }: Props) {
  const theme = useTheme();
  const copy = t.lessons[lesson.id as keyof typeof t.lessons];
  const playable = isPlayable(lesson);
  const status = statusOf(progress);
  const resume = resumeAt(progress);
  const ratio = barRatio(progress);
  const done = status === 'done';

  const watchLabel = done ? t.card.rewatch : status === 'inProgress' ? t.card.watchResume : t.card.watch;
  const statusColor = done ? 'success' : 'primary';

  return (
    <Box
      component="article"
      sx={{
        display: 'flex', flexDirection: 'column', borderRadius: '16px', overflow: 'hidden', bgcolor: 'background.paper',
        border: '1px solid', borderColor: done ? alpha(theme.palette.success.main, 0.45) : 'divider',
        transition: 'transform .2s ease, box-shadow .2s ease, border-color .2s ease',
        opacity: playable ? 1 : 0.85,
        '@media (hover: hover)': playable
          ? { '&:hover': { transform: 'translateY(-3px)', borderColor: 'primary.main', boxShadow: `0 14px 32px -18px ${alpha(theme.palette.primary.main, 0.7)}` } }
          : undefined,
        [REDUCED_MOTION]: { transition: 'none', '&:hover': { transform: 'none' } },
      }}
    >
      <Box
        component={playable ? 'button' : 'div'}
        type={playable ? 'button' : undefined}
        onClick={playable ? () => onOpen(lesson.id) : undefined}
        aria-label={playable ? t.card.play(copy.title) : undefined}
        sx={{
          all: 'unset', boxSizing: 'border-box', position: 'relative', display: 'block', width: '100%', aspectRatio: '16 / 9',
          cursor: playable ? 'pointer' : 'default', overflow: 'hidden', background: THUMB_FALLBACK,
          '&:focus-visible': { outline: '3px solid', outlineColor: 'primary.light', outlineOffset: '-3px' },
          '&:hover .play-fab': { transform: 'translate(-50%, -50%) scale(1.08)' },
        }}
      >
        {playable && lesson.youtubeId && (
          <Box component="img" src={thumbnailUrl(lesson.youtubeId)} alt="" loading="lazy" decoding="async"
            sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: done ? 'saturate(.7)' : 'none' }} />
        )}
        <Box sx={{ position: 'absolute', inset: 0, background: THUMB_SCRIM }} />

        {playable ? (
          <Box
            className="play-fab"
            sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 52, height: 52, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: 'primary.contrastText', boxShadow: '0 8px 24px rgba(0,0,0,.4)', transition: 'transform .2s ease', [REDUCED_MOTION]: { transition: 'none' } }}
          >
            <AppIcon icon={Play} size="lg" fill="currentColor" style={{ marginLeft: 2 }} />
          </Box>
        ) : (
          <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,.85)' }}>
            <Box sx={{ textAlign: 'center', px: 2 }}>
              <AppIcon icon={Clock} size="lg" />
              <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'inherit' }}>{t.card.soonHint}</Typography>
            </Box>
          </Box>
        )}

        <Chip label={t.card.lesson(lesson.number)} size="small"
          sx={{ position: 'absolute', top: 10, right: 10, fontWeight: 700, bgcolor: 'rgba(8,12,30,.78)', color: '#fff', backdropFilter: 'blur(4px)' }} />
        {playable && (
          <LinearProgress variant="determinate" value={ratio * 100} color={statusColor} aria-hidden
            sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, bgcolor: 'rgba(255,255,255,.25)', borderRadius: 0 }} />
        )}
      </Box>

      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1, flex: 1 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75 }}>
          <Chip size="small" variant="outlined" label={t.groups[lesson.group].title} sx={{ fontWeight: 600 }} />
          {!playable ? (
            <Chip size="small" icon={<AppIcon icon={Clock} />} label={t.card.soon} sx={{ fontWeight: 600 }} />
          ) : done ? (
            <Chip size="small" color="success" variant="outlined" icon={<AppIcon icon={CheckCircle2} />} label={t.card.status.done} sx={{ fontWeight: 600 }} />
          ) : status === 'inProgress' ? (
            <Chip size="small" color="primary" icon={<AppIcon icon={Play} />} label={t.card.watchedOf(Math.max(1, Math.round(ratio * 100)))} sx={{ fontWeight: 600 }} />
          ) : null}
        </Box>
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700, lineHeight: 1.3 }}>{copy.title}</Typography>
        <Typography variant="body2" color="text.secondary">{copy.description}</Typography>
        {resume > 0 && (
          <Typography variant="caption" color="primary" sx={{ fontWeight: 600 }}>{t.card.resume(formatClock(resume))}</Typography>
        )}

        {playable && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 'auto', pt: 1 }}>
            <Button
              variant="contained"
              size="small"
              onClick={() => onOpen(lesson.id)}
              startIcon={<AppIcon icon={done ? RotateCcw : Play} size="sm" fill={done ? 'none' : 'currentColor'} />}
              sx={{ backgroundImage: accentGradient(theme), mr: 'auto', px: 2, minHeight: 36 }}
            >
              {watchLabel}
            </Button>
            <Tooltip title={done ? t.card.markUndone : t.card.markDone} arrow>
              <IconButton aria-pressed={done} aria-label={done ? t.card.markUndone : t.card.markDone} onClick={() => onToggleDone(lesson.id)}
                sx={{ width: 40, height: 40, color: done ? 'success.main' : 'text.secondary' }}>
                <AppIcon icon={done ? CheckCircle2 : Circle} size="md" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t.card.share} arrow>
              <IconButton aria-label={t.card.share} onClick={() => onShare(lesson.id)} sx={{ width: 40, height: 40, color: 'text.secondary' }}>
                <AppIcon icon={Share2} size="md" />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>
    </Box>
  );
}
