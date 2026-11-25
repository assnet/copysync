import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/** prefers-reduced-motion seguro para pré-renderização (no servidor é sempre false). */
export function useReducedMotionSafe() {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(QUERY)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  )
}
