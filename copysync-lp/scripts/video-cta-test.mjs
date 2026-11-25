// Testa o botão "Ver a CopySync funcionando": rola até o vídeo, centraliza na área livre e pulsa o play.
import puppeteer from 'puppeteer-core'
const [url, out] = process.argv.slice(2)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
async function run(name, w, { consent, reduce } = {}) {
  const ctx = await b.createBrowserContext()
  const p = await ctx.newPage()
  const mobile = w < 768
  const h = mobile ? 844 : 900
  await p.setViewport({ width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile })
  if (reduce) await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  if (consent) await p.evaluateOnNewDocument((c) => localStorage.setItem('cs-consent', c), consent)
  await p.goto(url, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => Object.keys(document.getElementById('root')).some((k) => k.startsWith('__react')))
  const t0 = Date.now()
  await p.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.textContent.includes('Ver a CopySync funcionando')).click())
  // espera o pulso começar (= chegou)
  await p.waitForFunction(() => !!document.querySelector('#video [class*="cs-beat"], #video [class*="cs-ring"]') || document.activeElement?.closest('#video'), { timeout: 8000 })
  const chegada = Date.now() - t0
  await wait(350)
  await p.screenshot({ path: `${out}/video-${name}.png` })
  const m = await p.evaluate(() => {
    const v = document.getElementById('video').getBoundingClientRect()
    const bars = [...document.querySelectorAll('[data-bottom-bar]')].map((e) => {
      const r = e.getBoundingClientRect()
      return { bar: e.dataset.bottomBar, top: Math.round(r.top), height: Math.round(r.height), naTela: getComputedStyle(e).display !== 'none' && r.top < innerHeight - 1 }
    })
    const visiveis = bars.filter((x) => x.naTela)
    const livreAte = visiveis.length ? Math.min(...visiveis.map((x) => x.top)) : innerHeight
    const ev = (window.dataLayer || []).filter((x) => x && x.event === 'cta_click')
    return {
      video: { top: Math.round(v.top), bottom: Math.round(v.bottom), height: Math.round(v.height) },
      areaLivre: [0, livreAte],
      folgaCima: Math.round(v.top),
      folgaBaixo: Math.round(livreAte - v.bottom),
      barras: visiveis.map((x) => `${x.bar} ${x.height}px`),
      pulso: !!document.querySelector('#video [class*="cs-beat"]'),
      foco: document.activeElement?.getAttribute('aria-label'),
      hash: location.hash,
      evento: ev.at(-1),
    }
  })
  await wait(2000)
  m.pulsoDepoisDe2s = await p.evaluate(() => !!document.querySelector('#video [class*="cs-beat"]'))
  console.log(name, JSON.stringify({ chegadaMs: chegada, ...m }))
  await ctx.close()
}
await run('390-sem-escolha', 390)
await run('390-com-escolha', 390, { consent: 'granted' })
await run('1440-sem-escolha', 1440)
await run('1440-com-escolha', 1440, { consent: 'denied' })
await run('390-movimento-reduzido', 390, { reduce: true, consent: 'granted' })
await b.close()
