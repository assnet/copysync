import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Box, ButtonBase, Divider, Popover, Tooltip, alpha } from '@mui/material';
import AddReactionOutlinedIcon from '@mui/icons-material/AddReactionOutlined';
// Import direto (não pelo barrel `components/index.ts`) para a lib do picker seguir lazy.
import { EmojiPicker } from '@/components/EmojiPicker';
import { chatStrings } from '@/features/chat/strings';

/**
 * Barra de reações rápidas de uma mensagem (Popover ancorado no botão de reagir).
 *
 * - Clicar no emoji já ativo emite `onSelect(null)` — é a remoção (toggle).
 * - Emoji ativo marcado por anel + ponto (não só cor) e `aria-pressed`.
 * - Setas/Home/End movem o foco (roving tabindex); `Esc` fecha e o Popover devolve o foco
 *   ao elemento de origem.
 * - `+` troca a barra pelo picker completo no mesmo Popover; escolher lá seleciona e fecha.
 */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

export type ReactionBarProps = {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  /** Reação atual do usuário na mensagem, ou `null`. */
  activeEmoji: string | null;
  onSelect: (emoji: string | null) => void;
};

const texts = chatStrings.reactions;
const BUTTON_SIZE = 40;

export function ReactionBar({ anchorEl, open, onClose, activeEmoji, onSelect }: ReactionBarProps) {
  const [showPicker, setShowPicker] = useState(false);

  const select = (emoji: string | null) => {
    onSelect(emoji);
    onClose();
  };

  return (
    <Popover
      open={open && Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      slotProps={{
        paper: {
          elevation: 6,
          sx: showPicker
            ? { borderRadius: 2, overflow: 'hidden' }
            : (theme) => ({
                borderRadius: `${BUTTON_SIZE}px`,
                border: `1px solid ${theme.palette.divider}`,
                mb: 0.5,
              }),
        },
      }}
      TransitionProps={{ onExited: () => setShowPicker(false) }}
    >
      {showPicker ? (
        <EmojiPicker
          onSelect={(emoji) => select(emoji)}
          onClose={() => setShowPicker(false)}
        />
      ) : (
        <QuickBar activeEmoji={activeEmoji} onPick={select} onOpenPicker={() => setShowPicker(true)} />
      )}
    </Popover>
  );
}

type QuickBarProps = {
  activeEmoji: string | null;
  onPick: (emoji: string | null) => void;
  onOpenPicker: () => void;
};

function QuickBar({ activeEmoji, onPick, onOpenPicker }: QuickBarProps) {
  const itemCount = QUICK_REACTIONS.length + 1; // + botão do picker
  const initialIndex = Math.max(0, QUICK_REACTIONS.findIndex((emoji) => emoji === activeEmoji));
  const [focusIndex, setFocusIndex] = useState(initialIndex);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // Foco inicial dentro da barra (antes do FocusTrap do Popover focar o container).
  useEffect(() => {
    refs.current[initialIndex]?.focus();
    // Só na montagem (= abertura da barra).
  }, []);

  const moveFocus = (index: number) => {
    const next = (index + itemCount) % itemCount;
    setFocusIndex(next);
    refs.current[next]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowRight: focusIndex + 1,
      ArrowDown: focusIndex + 1,
      ArrowLeft: focusIndex - 1,
      ArrowUp: focusIndex - 1,
      Home: 0,
      End: itemCount - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      moveFocus(moves[event.key]);
    }
  };

  return (
    <Box
      role="toolbar"
      aria-label={texts.quickBar}
      aria-orientation="horizontal"
      onKeyDown={handleKeyDown}
      sx={{ display: 'flex', alignItems: 'center', gap: 0.25, p: 0.5 }}
    >
      {QUICK_REACTIONS.map((emoji, index) => {
        const active = emoji === activeEmoji;
        return (
          <Tooltip key={emoji} title={active ? texts.remove : texts.react} describeChild disableInteractive>
            <ButtonBase
              ref={(el) => {
                refs.current[index] = el;
              }}
              aria-pressed={active}
              tabIndex={focusIndex === index ? 0 : -1}
              onFocus={() => setFocusIndex(index)}
              onClick={() => onPick(active ? null : emoji)}
              sx={(theme) => ({
                position: 'relative',
                width: BUTTON_SIZE,
                height: BUTTON_SIZE,
                borderRadius: '50%',
                fontSize: 22,
                lineHeight: 1,
                border: '2px solid',
                borderColor: active ? theme.palette.primary.main : 'transparent',
                bgcolor: active ? alpha(theme.palette.primary.main, 0.14) : 'transparent',
                transition: theme.transitions.create(['transform', 'background-color'], {
                  duration: theme.transitions.duration.shortest,
                }),
                '& > span[data-emoji]': {
                  display: 'inline-block',
                  transition: 'inherit',
                },
                '&:hover': {
                  bgcolor: active
                    ? alpha(theme.palette.primary.main, 0.22)
                    : theme.palette.action.hover,
                  '& > span[data-emoji]': { transform: 'scale(1.18)' },
                },
                '&.Mui-focusVisible': {
                  outline: `2px solid ${theme.palette.primary.main}`,
                  outlineOffset: 2,
                },
                // Ponto sob o emoji ativo: marca que não depende de distinguir cor.
                '&::after': active
                  ? {
                      content: '""',
                      position: 'absolute',
                      bottom: -6,
                      left: '50%',
                      width: 4,
                      height: 4,
                      ml: '-2px',
                      borderRadius: '50%',
                      bgcolor: theme.palette.primary.main,
                    }
                  : undefined,
                '@media (prefers-reduced-motion: reduce)': {
                  transition: 'none',
                  '&:hover > span[data-emoji]': { transform: 'none' },
                },
              })}
            >
              <span data-emoji>{emoji}</span>
            </ButtonBase>
          </Tooltip>
        );
      })}
      <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 1 }} />
      <Tooltip title={texts.openFullPicker} disableInteractive>
        <ButtonBase
          ref={(el) => {
            refs.current[itemCount - 1] = el;
          }}
          aria-haspopup="dialog"
          tabIndex={focusIndex === itemCount - 1 ? 0 : -1}
          onFocus={() => setFocusIndex(itemCount - 1)}
          onClick={onOpenPicker}
          sx={(theme) => ({
            width: BUTTON_SIZE,
            height: BUTTON_SIZE,
            borderRadius: '50%',
            color: theme.palette.text.secondary,
            '&:hover': { bgcolor: theme.palette.action.hover, color: theme.palette.text.primary },
            '&.Mui-focusVisible': {
              outline: `2px solid ${theme.palette.primary.main}`,
              outlineOffset: 2,
            },
          })}
        >
          <AddReactionOutlinedIcon fontSize="small" />
        </ButtonBase>
      </Tooltip>
    </Box>
  );
}
