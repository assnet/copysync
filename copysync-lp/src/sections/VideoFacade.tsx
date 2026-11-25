import { useEffect, useRef, useState } from 'react'
import { VIDEO_SHOWS_REAL_PRODUCT, YOUTUBE_ID } from '../config'
import { VIDEO_ATTENTION_EVENT } from '../lib/scrollToVideo'
import { track } from '../lib/track'

/**
 * Vídeo do YouTube com "fachada": só a miniatura (lazy) + botão de play.
 * O iframe (youtube-nocookie) só é criado no clique — nada do YouTube carrega antes disso.
 */
export function VideoFacade() {
  const [playing, setPlaying] = useState(false)
  // pulso leve no play quando a pessoa chega pelo botão do hero
  const [pulse, setPulse] = useState(0)
  const playRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    let timer = 0
    const onAttention = () => {
      playRef.current?.focus({ preventScroll: true })
      setPulse((n) => n + 1)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setPulse(0), 1800)
    }
    window.addEventListener(VIDEO_ATTENTION_EVENT, onAttention)
    return () => {
      window.removeEventListener(VIDEO_ATTENTION_EVENT, onAttention)
      window.clearTimeout(timer)
    }
  }, [])
  const title = VIDEO_SHOWS_REAL_PRODUCT ? 'Agora, Gravado de Verdade.' : 'Veja a CopySync em vídeo'

  return (
    <div className="mx-auto mt-20 max-w-3xl">
      <h3 className="text-center font-display text-2xl font-extrabold tracking-[-0.02em] text-ink sm:text-3xl">{title}</h3>

      {/* scroll-margin: sem JS, o link #video ainda para com o vídeo perto do centro da tela */}
      <div
        id="video"
        className="relative mt-6 aspect-video scroll-mt-[max(12px,calc((100svh-88px-min(100vw-32px,768px)*0.5625)/2))] overflow-hidden rounded-[24px] bg-ink shadow-[0_1px_2px_rgba(15,17,23,.06),0_30px_60px_-28px_rgba(41,48,110,.5)] ring-1 ring-black/5"
      >
        {playing ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${YOUTUBE_ID}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="absolute inset-0 size-full"
          />
        ) : (
          <button
            ref={playRef}
            type="button"
            onClick={() => {
              track('video_play', { video_id: YOUTUBE_ID })
              setPlaying(true)
            }}
            className="group absolute inset-0 size-full"
            aria-label={`Assistir: ${title}`}
          >
            <img
              src={`https://i.ytimg.com/vi/${YOUTUBE_ID}/hqdefault.jpg`}
              alt=""
              loading="lazy"
              decoding="async"
              width={480}
              height={360}
              className="absolute inset-0 size-full object-cover transition duration-500 group-hover:scale-[1.02]"
            />
            <span className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,17,23,0)_40%,rgba(15,17,23,.45))]" />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <span
                key={pulse}
                className={`relative grid size-20 place-items-center rounded-full bg-[linear-gradient(135deg,#5869da,#7042e3)] text-white shadow-[0_0_0_10px_rgba(255,255,255,.18),0_20px_40px_-10px_rgba(41,48,110,.7)] transition group-hover:scale-105 ${pulse ? 'motion-safe:animate-[cs-beat_1.7s_ease-in-out]' : ''}`}
              >
                {pulse > 0 && (
                  <>
                    <span className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/90 motion-safe:animate-[cs-ring_.85s_ease-out_2] motion-reduce:hidden" />
                    <span className="pointer-events-none absolute inset-0 rounded-full border-2 border-brand-light motion-safe:animate-[cs-ring_.85s_.2s_ease-out_2_both] motion-reduce:hidden" />
                  </>
                )}
                <svg viewBox="0 0 24 24" className="ml-1 size-8" fill="currentColor" aria-hidden="true">
                  <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
                </svg>
              </span>
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
