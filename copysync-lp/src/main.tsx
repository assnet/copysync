import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initCheckoutClicks } from './lib/checkoutClicks'
import { initFunnelBeacon } from './lib/funnelBeacon'

const root = document.getElementById('root')!
const app = (
  <StrictMode>
    <App />
  </StrictMode>
)

// Em produção o HTML já vem pré-renderizado (LCP sem esperar o JS); aqui só "hidrata".
if (root.hasChildNodes()) hydrateRoot(root, app)
else createRoot(root).render(app)

// GA4: "clique_assinar" em qualquer link para o checkout da Cakto
initCheckoutClicks()

// Funil anônimo sem cookies (/b.gif no registro de acesso do servidor), para todos os visitantes
initFunnelBeacon()
