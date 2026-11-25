import { useEffect, useRef, useState } from 'react'
import type { Clip } from '../media/clips'
import { useReducedMotionSafe } from '../lib/useReducedMotion'

/**
 * Clipe curto do painel real: mudo, em loop, playsinline.
 * Nada do vídeo é baixado antes de o clipe chegar perto da tela (só o poster, com loading="lazy").
 * Celular (<640px) usa a versão 4:5; telas maiores, a 16:9.
 * Toca só enquanto está visível. Com "reduzir movimento", não toca sozinho: a pessoa toca no play.
 */
export function LoopClip({
  clip,
  label,
  className = '',
  frameClassName = '',
}: {
  clip: Clip
  /** descrição do que o clipe mostra (leitores de tela) */
  label: string
  className?: string
  frameClassName?: string
}) {
  const reduce = useReducedMotionSafe()
  const wrapRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [variant, setVariant] = useState<'wide' | 'tall' | null>(null)
  const [visible, setVisible] = useState(false)
  const [paused, setPaused] = useState(false)

  // 1) perto da tela (300px antes) → escolhe a versão e carrega
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const near = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return
        setVariant(window.matchMedia('(min-width: 640px)').matches ? 'wide' : 'tall')
        near.disconnect()
      },
      { rootMargin: '300px 0px' },
    )
    near.observe(el)
    const seen = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.2 })
    seen.observe(el)
    return () => {
      near.disconnect()
      seen.disconnect()
    }
  }, [])

  // 2) toca enquanto visível; pausa fora da tela ou quando a pessoa pausou
  const autoplay = !reduce
  const [userPlay, setUserPlay] = useState(false)
  const shouldPlay = visible && !paused && (autoplay || userPlay)
  useEffect(() => {
    const v = videoRef.current
    if (!v || !variant) return
    if (shouldPlay) v.play().catch(() => {})
    else v.pause()
  }, [shouldPlay, variant])

  const src = variant ? clip[variant] : null

  return (
    <div
      ref={wrapRef}
      className={`relative overflow-hidden bg-ice aspect-[4/5] sm:aspect-video ${frameClassName} ${className}`}
    >
      <picture>
        <source media="(min-width: 640px)" srcSet={clip.wide.poster} />
        <img
          src={clip.tall.poster}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      </picture>
      {src && (
        <video
          key={variant}
          ref={videoRef}
          muted
          loop
          playsInline
          preload="auto"
          poster={src.poster}
          aria-label={label}
          className="absolute inset-0 size-full object-cover"
        >
          <source src={src.webm} type="video/webm" />
          <source src={src.mp4} type="video/mp4" />
        </video>
      )}
      {!src && <span className="sr-only">{label}</span>}

      {/* pausar / tocar (o clipe passa de 5 s em loop) */}
      <button
        type="button"
        onClick={() => {
          if (shouldPlay) setPaused(true)
          else {
            setPaused(false)
            setUserPlay(true)
          }
        }}
        aria-label={shouldPlay ? 'Pausar o clipe' : 'Tocar o clipe'}
        className={`absolute bottom-2.5 right-2.5 grid size-9 place-items-center rounded-full bg-ink/70 text-white shadow-[0_4px_12px_-4px_rgba(15,17,23,.5)] backdrop-blur transition hover:bg-ink/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${!shouldPlay && !autoplay ? 'size-12' : ''}`}
      >
        {shouldPlay ? (
          <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="ml-0.5 size-4" fill="currentColor" aria-hidden="true">
            <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
          </svg>
        )}
      </button>
    </div>
  )
}
