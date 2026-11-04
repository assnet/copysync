import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Box, ButtonBase, Typography, alpha, useMediaQuery, useTheme } from '@mui/material';
import { Check, Pause } from 'lucide-react';
import { AppIcon } from './AppIcon';
import { swipeCardsStrings as t } from './swipeCardsStrings';

export type SwipeCardsStatus = 'done' | 'paused' | 'pending';

export interface SwipeCardsItem {
  key: string;
  label: string;
  status?: SwipeCardsStatus;
  content: ReactNode;
}

export interface SwipeCardsProps {
  items: SwipeCardsItem[];
  /** Card centralizado ao montar (ex.: plano recomendado). */
  initialKey?: string;
  /** Nome do carrossel para leitor de tela. */
  ariaLabel: string;
  /** Só usado no mobile; em `sm+` renderiza `renderGrid(items)` sem wrapper. */
  renderGrid: (items: SwipeCardsItem[]) => ReactNode;
}

// Card 78 % do trilho: sobra 11 % de cada lado para o vizinho aparecer de verdade (≈ 27 px em 390 px
// já descontada a escala 0.96), não só uma lasca.
const CARD_WIDTH = '78%';
const GAP_PX = 10;
/**
 * Espaçador das pontas: mesma base do `78%`. Desconta o `gap` duas vezes para a margem do primeiro/
 * último card (espaçador + gap) ser igual ao peek do vizinho no outro lado (11 % − gap): pontas simétricas.
 */
const EDGE_SPACER = `calc(11% - ${GAP_PX * 2}px)`;
const MOTION_MS = 220;

/** `scrollLeft` que centraliza o card no trilho (`offsetLeft` relativo ao trilho, que é `position: relative`). */
function centeredScrollLeft(track: HTMLElement, card: HTMLElement): number {
  return card.offsetLeft - (track.clientWidth - card.offsetWidth) / 2;
}

/** Índice do card cujo centro está mais perto do centro do trilho. */
export function nearestCardIndex(trackCenter: number, cardCenters: number[]): number {
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  cardCenters.forEach((c, i) => {
    const d = Math.abs(c - trackCenter);
    if (d < bestDist) { best = i; bestDist = d; }
  });
  return best;
}

/**
 * Cards em carrossel por deslize no mobile (`xs`): um empurrão = um card, scroll-snap nativo,
 * indicadores em pílula acima do trilho (os cards são altos; abaixo ficariam fora da dobra).
 * Em `sm+` devolve a grade recebida sem alterar nada.
 * Sem lib: o card ativo vem do `scrollLeft` (não depende de `IntersectionObserver`).
 */
export function SwipeCards({ items, initialKey, ariaLabel, renderGrid }: SwipeCardsProps) {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  if (!mobile) return <>{renderGrid(items)}</>;
  return <SwipeTrack items={items} initialKey={initialKey} ariaLabel={ariaLabel} />;
}

type TrackProps = Omit<SwipeCardsProps, 'renderGrid'>;

function SwipeTrack({ items, initialKey, ariaLabel }: TrackProps) {
  const theme = useTheme();
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)', { noSsr: true });
  const trackRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rafRef = useRef<number | null>(null);
  /** Alvo de uma rolagem programática: enquanto não chega, o `scroll` não muda o ativo (indicador não pisca). */
  const targetRef = useRef<number | null>(null);
  const baseId = useId();
  const initialIndex = Math.max(0, items.findIndex((i) => i.key === initialKey));
  const [active, setActive] = useState(initialIndex);

  // Lista mudou: o ativo nunca aponta para fora dela
  const keys = items.map((i) => i.key).join('\u0000');
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, items.length - 1)));
    cardRefs.current.length = items.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);

  const scrollToIndex = useCallback((index: number, smooth: boolean) => {
    const track = trackRef.current;
    const card = cardRefs.current[index];
    if (!track || !card) return;
    const left = centeredScrollLeft(track, card);
    // jsdom não implementa `scrollTo` em elemento: cai no `scrollLeft` direto
    if (smooth && !reducedMotion && typeof track.scrollTo === 'function') {
      targetRef.current = index;
      track.scrollTo({ left, behavior: 'smooth' });
    } else {
      targetRef.current = null;
      track.scrollLeft = left;
    }
    setActive(index);
  }, [reducedMotion]);

  // Posição inicial antes da pintura (sem flash do 1º card), sem animação e sem mexer no eixo
  // vertical da página (por isso `scrollLeft`, não `scrollIntoView`)
  useLayoutEffect(() => {
    scrollToIndex(initialIndex, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Índice do card mais perto do centro, só filhos reais (os espaçadores são pseudo-elementos, sem ref). */
  const nearestNow = useCallback(() => {
    const track = trackRef.current;
    if (!track) return 0;
    const center = track.scrollLeft + track.clientWidth / 2;
    const centers = cardRefs.current.map((c) => (c ? c.offsetLeft + c.offsetWidth / 2 : Number.POSITIVE_INFINITY));
    return nearestCardIndex(center, centers);
  }, []);

  const onScroll = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const nearest = nearestNow();
      if (targetRef.current != null) {
        if (nearest === targetRef.current) targetRef.current = null;
        return;
      }
      setActive(nearest);
    });
  }, [nearestNow]);

  // `scrollend` (quando existe) encerra a rolagem programática mesmo que o snap pare fora do alvo
  useEffect(() => {
    const track = trackRef.current;
    if (!track || !('onscrollend' in window)) return;
    const onEnd = () => {
      targetRef.current = null;
      setActive(nearestNow());
    };
    track.addEventListener('scrollend', onEnd);
    return () => track.removeEventListener('scrollend', onEnd);
  }, [nearestNow]);

  useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Só com o trilho em foco: setas dentro de um controle do card são dele
    if (e.target !== e.currentTarget) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = e.key === 'ArrowLeft' ? Math.max(0, active - 1) : Math.min(items.length - 1, active + 1);
    if (next === active) return;
    e.preventDefault();
    scrollToIndex(next, true);
  };

  const transition = reducedMotion ? 'none' : theme.transitions.create(['transform', 'filter'], { duration: MOTION_MS });
  const slideId = (i: number) => `${baseId}-slide-${i}`;

  return (
    <Box>
      <Box
        role="group"
        aria-label={t.indicatorsLabel}
        sx={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 0.75, mb: 1 }}
      >
        {items.map((item, i) => {
          const isActive = i === active;
          const statusText = item.status === 'done' ? t.statusDone : item.status === 'paused' ? t.statusPaused : item.status === 'pending' ? t.statusPending : null;
          return (
            <ButtonBase
              key={item.key}
              aria-current={isActive ? 'true' : undefined}
              onClick={() => scrollToIndex(i, true)}
              sx={{
                // Alvo ≥ 44 px; o visual compacto fica na pílula interna
                minHeight: 44,
                px: 0.5,
                borderRadius: 999,
                '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
              }}
            >
              <Box
                sx={{
                  display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1.25, py: 0.5, borderRadius: 999,
                  bgcolor: isActive ? 'primary.main' : alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.12 : 0.06),
                  color: isActive ? 'primary.contrastText' : 'text.secondary',
                  transition: reducedMotion ? 'none' : theme.transitions.create(['background-color', 'color'], { duration: MOTION_MS }),
                }}
              >
                {item.status === 'done' && (
                  <Box sx={{ display: 'flex', color: isActive ? 'inherit' : 'success.main' }}>
                    <AppIcon icon={Check} size="sm" strokeWidth={3} />
                  </Box>
                )}
                {item.status === 'paused' && (
                  <Box sx={{ display: 'flex', color: isActive ? 'inherit' : 'warning.main' }}>
                    <AppIcon icon={Pause} size="sm" strokeWidth={3} />
                  </Box>
                )}
                {item.status === 'pending' && (
                  <Box aria-hidden sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: isActive ? 'primary.contrastText' : 'text.disabled', opacity: 0.8 }} />
                )}
                <Typography component="span" variant="caption" sx={{ fontWeight: 700, lineHeight: 1 }}>
                  {item.label}
                </Typography>
                {statusText && <Box component="span" sx={visuallyHidden}>{`, ${statusText}`}</Box>}
              </Box>
            </ButtonBase>
          );
        })}
      </Box>

      <Box
        ref={trackRef}
        role="group"
        aria-roledescription={t.carouselRole}
        aria-label={ariaLabel}
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        sx={{
          position: 'relative',
          display: 'flex',
          alignItems: 'stretch',
          gap: `${GAP_PX}px`,
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollSnapType: 'x mandatory',
          overscrollBehaviorX: 'contain',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
          // Pontas: espaçadores na mesma base de medida do card (padding no trilho mede contra o pai e desalinha)
          '&::before, &::after': { content: '""', flex: `0 0 ${EDGE_SPACER}` },
          // Espaço para selo acima do card (ex.: "Mais escolhido") e para a sombra, que o `overflow` cortaria
          pt: 2,
          pb: 1.5,
          mx: -2,
          outline: 'none',
          borderRadius: 2,
          '&:focus-visible': { boxShadow: `inset 0 0 0 2px ${theme.palette.primary.main}` },
        }}
      >
        {items.map((item, i) => {
          const isActive = i === active;
          return (
            <Box
              key={item.key}
              id={slideId(i)}
              ref={(el: HTMLDivElement | null) => { cardRefs.current[i] = el; }}
              role="group"
              aria-roledescription={t.slideRole}
              aria-label={t.slideLabel(item.label, i + 1, items.length)}
              aria-current={isActive ? 'true' : undefined}
              sx={{
                flex: `0 0 ${CARD_WIDTH}`,
                minWidth: 0,
                scrollSnapAlign: 'center',
                scrollSnapStop: 'always',
                display: 'flex',
                flexDirection: 'column',
                '& > *': { flexGrow: 1 },
                // Só escala e saturação no vizinho: nada que reduza contraste de texto
                transform: isActive ? 'scale(1)' : 'scale(0.96)',
                filter: isActive ? 'none' : 'saturate(0.85)',
                transition,
                willChange: 'transform',
              }}
            >
              {item.content}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

const visuallyHidden = {
  position: 'absolute', width: 1, height: 1, p: 0, m: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
} as const;
