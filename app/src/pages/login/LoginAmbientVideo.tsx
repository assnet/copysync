import { useEffect, useRef, useState } from 'react';
import { Box, useMediaQuery, useTheme } from '@mui/material';

/** Duração do fade do vídeo sobre o poster (ms). */
const FADE_MS = 600;
/** Fallback de `requestIdleCallback`: espera do primeiro paint antes de carregar o vídeo. */
const IDLE_FALLBACK_MS = 300;

/** Subconjunto de `navigator.connection` (Network Information API, sem tipo no DOM lib). */
interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
}

/**
 * Decide se o vídeo ambiente pode ser carregado: só no desktop (md+, onde o painel
 * é exibido — o mobile oculta o painel por CSS e não deve baixar o vídeo), e respeita
 * `prefers-reduced-motion`, `Save-Data` e redes lentas (`2g`/`slow-2g`). Reage à
 * mudança das media queries; começa em `false` para o primeiro render não criar o `<video>`.
 */
export function useAmbientVideoAllowed(): boolean {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'), { noSsr: true });
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
    const slowNetwork =
      connection?.saveData === true ||
      connection?.effectiveType === '2g' ||
      connection?.effectiveType === 'slow-2g';

    const update = () => setAllowed(desktop && !reduced.matches && !slowNetwork);
    update();
    reduced.addEventListener('change', update);
    return () => reduced.removeEventListener('change', update);
  }, [desktop]);

  return allowed;
}

export interface LoginAmbientVideoProps {
  /** Primeiro frame do trecho — exibido antes do vídeo e como fallback. */
  poster: string;
  webmSrc: string;
  mp4Src: string;
  /** `object-position` da camada (igual ao da foto para não haver salto). */
  objectPosition?: string;
}

/**
 * Vídeo ambiente em loop atrás do overlay do painel de login (desktop).
 *
 * - Só monta o `<video>` depois do primeiro paint (`requestIdleCallback`).
 * - Não monta quando movimento reduzido, Save-Data ou rede 2g (fica o poster).
 * - Fade-in de 600 ms no `canplay`; `play()` rejeitado deixa o poster, sem erro.
 * - Pausa quando a aba fica oculta e retoma ao voltar.
 * - Loop contínuo garantido: além do atributo `loop`, se `ended` disparar (alguns
 *   browsers com `loop` + `preload="none"`), volta a `currentTime = 0` e toca de novo.
 */
export function LoginAmbientVideo({ poster, webmSrc, mp4Src, objectPosition = '62% 40%' }: LoginAmbientVideoProps) {
  const allowed = useAmbientVideoAllowed();
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Adia a criação do <video> para depois do primeiro paint.
  useEffect(() => {
    if (!allowed) {
      setMounted(false);
      setVisible(false);
      return;
    }
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(() => setMounted(true));
      return () => w.cancelIdleCallback?.(id);
    }
    const timer = window.setTimeout(() => setMounted(true), IDLE_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [allowed]);

  // Carrega, toca e pausa/retoma conforme a visibilidade da aba.
  useEffect(() => {
    const video = videoRef.current;
    if (!mounted || !video) return;

    const tryPlay = () => {
      const result = video.play();
      if (result && typeof result.catch === 'function') result.catch(() => undefined);
    };
    const onVisibility = () => {
      if (document.hidden) video.pause();
      else tryPlay();
    };
    const onEnded = () => {
      video.currentTime = 0;
      tryPlay();
    };

    video.load();
    tryPlay();
    document.addEventListener('visibilitychange', onVisibility);
    video.addEventListener('ended', onEnded);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      video.removeEventListener('ended', onEnded);
      video.pause();
    };
  }, [mounted]);

  const layer = {
    position: 'absolute', inset: 0, width: '100%', height: '100%',
    objectFit: 'cover', objectPosition,
  } as const;

  return (
    <>
      <Box
        component="img"
        src={poster}
        alt=""
        aria-hidden
        width={1280}
        height={720}
        fetchPriority="high"
        decoding="async"
        sx={{ ...layer, zIndex: -3 }}
      />
      {mounted && (
        <Box
          component="video"
          ref={videoRef}
          muted
          autoPlay
          loop
          playsInline
          preload="none"
          poster={poster}
          aria-hidden
          disablePictureInPicture
          onCanPlay={() => setVisible(true)}
          sx={{
            ...layer,
            zIndex: -2,
            opacity: visible ? 1 : 0,
            transition: `opacity ${FADE_MS}ms ease`,
          }}
        >
          <source src={webmSrc} type="video/webm" />
          <source src={mp4Src} type="video/mp4" />
        </Box>
      )}
    </>
  );
}
