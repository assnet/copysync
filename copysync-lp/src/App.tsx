import { useEffect, useRef, useState } from 'react'
import { CookieConsent } from './components/CookieBanner'
import { StickyCta } from './components/StickyCta'
import { SupportFloat } from './components/SupportFloat'
import { Closing } from './sections/Closing'
import { Cost } from './sections/Cost'
import { Demo } from './sections/Demo'
import { Extras } from './sections/Extras'
import { Faq } from './sections/Faq'
import { Hero } from './sections/Hero'
import { Mechanism } from './sections/Mechanism'
import { ProblemRace } from './sections/ProblemRace'
import { Plans } from './sections/plans/Plans'
import { RealProof } from './sections/RealProof'

export default function App() {
  const heroRef = useRef<HTMLElement>(null)
  const pastHero = usePastElement(heroRef)
  // enquanto o aviso de cookies estiver na tela, a barra fixa de CTA fica escondida
  const [consentOpen, setConsentOpen] = useState(false)

  return (
    <>
      <main>
        <Hero ref={heroRef} />
        <ProblemRace />
        <Mechanism />
        <RealProof />
        <Demo />
        <Extras />
        <Cost />
        <Plans />
        <Faq />
        <Closing />
      </main>
      <StickyCta visible={pastHero && !consentOpen} />
      <SupportFloat raised={pastHero && !consentOpen} hidden={consentOpen} />
      <CookieConsent onVisibleChange={setConsentOpen} />
    </>
  )
}

/** true quando o elemento já saiu da tela por cima (o usuário rolou além dele). */
function usePastElement(ref: React.RefObject<HTMLElement | null>) {
  const [past, setPast] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => {
      setPast(!entry.isIntersecting && entry.boundingClientRect.top < 0)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [ref])
  return past
}
