import { Box, Tooltip, alpha, useTheme } from '@mui/material';
import type { MessageReaction } from '../../types';
import { chatStrings } from '../../strings';

interface Props {
  reactions: MessageReaction[];
  /** Ausente → chips só leitura (visíveis, sem clique). */
  onToggle?: (emoji: string, reactedByMe: boolean) => void;
}

/** Junta entradas repetidas do mesmo emoji preservando a ordem da primeira aparição. */
function groupByEmoji(reactions: MessageReaction[]): MessageReaction[] {
  const byEmoji = new Map<string, MessageReaction>();
  for (const r of reactions) {
    if (r.count <= 0) continue;
    const prev = byEmoji.get(r.emoji);
    byEmoji.set(
      r.emoji,
      prev
        ? {
            emoji: r.emoji,
            count: prev.count + r.count,
            reactedByMe: prev.reactedByMe || r.reactedByMe,
            reactors: [...prev.reactors, ...r.reactors],
          }
        : r,
    );
  }
  return [...byEmoji.values()];
}

export function MessageReactions({ reactions, onToggle }: Props) {
  const theme = useTheme();
  const groups = groupByEmoji(reactions);
  if (groups.length === 0) return null;

  const t = chatStrings.reactions;
  const isDark = theme.palette.mode === 'dark';
  const accent = theme.palette.primary.main;

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 0.5,
        maxWidth: '100%',
        minWidth: 0,
      }}
    >
      {groups.map((r) => {
        const names = r.reactors.map((p) => p.name ?? t.participant);
        const interactive = Boolean(onToggle);
        return (
          <Tooltip key={r.emoji} title={t.reactorsTooltip(names)} placement="top" arrow>
            <Box
              component={interactive ? 'button' : 'span'}
              {...(interactive
                ? {
                    type: 'button' as const,
                    'aria-pressed': r.reactedByMe,
                    onClick: () => onToggle?.(r.emoji, r.reactedByMe),
                  }
                : { role: 'img', tabIndex: 0 })}
              aria-label={t.chipLabel(r.emoji, r.count)}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.4,
                minHeight: 24,
                minWidth: 32,
                px: 0.9,
                m: 0,
                borderRadius: 999,
                border: '1px solid',
                borderColor: r.reactedByMe ? accent : theme.palette.divider,
                // Segunda linha de borda: destaque que não depende só da cor.
                boxShadow: r.reactedByMe
                  ? `inset 0 0 0 1px ${accent}, ${theme.shadows[1]}`
                  : theme.shadows[1],
                bgcolor: r.reactedByMe
                  ? alpha(accent, isDark ? 0.28 : 0.12)
                  : theme.palette.background.paper,
                color: theme.palette.text.primary,
                font: 'inherit',
                lineHeight: 1,
                cursor: interactive ? 'pointer' : 'default',
                touchAction: 'manipulation',
                userSelect: 'none',
                transition: theme.transitions.create(['background-color', 'border-color'], {
                  duration: theme.transitions.duration.shortest,
                }),
                '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                ...(interactive && {
                  '&:hover': {
                    bgcolor: alpha(accent, r.reactedByMe ? (isDark ? 0.36 : 0.18) : 0.08),
                  },
                }),
                '&:focus-visible': {
                  outline: `2px solid ${accent}`,
                  outlineOffset: 2,
                },
              }}
            >
              <Box component="span" aria-hidden sx={{ fontSize: 14, lineHeight: 1 }}>
                {r.emoji}
              </Box>
              {r.count > 1 && (
                <Box
                  component="span"
                  aria-hidden
                  sx={{
                    fontSize: 12,
                    fontWeight: r.reactedByMe ? 700 : 500,
                    fontVariantNumeric: 'tabular-nums',
                    color: r.reactedByMe ? theme.palette.text.primary : theme.palette.text.secondary,
                  }}
                >
                  {r.count}
                </Box>
              )}
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
}
