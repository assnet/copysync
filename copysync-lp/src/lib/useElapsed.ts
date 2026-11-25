import { useEffect, useRef, useState } from 'react'

/**
 * Relógio simples em ms que corre enquanto `running` for true, até `max` (pausa e retoma).
 * Muda `resetKey` para zerar. Com `reduce` (prefers-reduced-motion) devolve `max`: estado final, sem movimento.
 */
export function useElapsed(running: boolean, max: number, reduce: boolean, resetKey?: unknown) {
  const [ms, setMs] = useState(0)
  const msRef = useRef(0)

  useEffect(() => {
    msRef.current = 0
    setMs(0)
  }, [resetKey])

  useEffect(() => {
    if (!running || reduce) return
    const start = performance.now() - msRef.current
    const id = window.setInterval(() => {
      const next = Math.min(max, performance.now() - start)
      msRef.current = next
      setMs(next)
      if (next >= max) window.clearInterval(id)
    }, 80)
    return () => window.clearInterval(id)
  }, [running, max, reduce, resetKey])

  return reduce ? max : ms
}
