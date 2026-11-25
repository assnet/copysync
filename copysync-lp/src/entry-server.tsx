import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import App from './App'

/** Pré-renderização: o HTML da página sai pronto do build (LCP sem esperar o JavaScript). */
export function render() {
  return renderToString(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
