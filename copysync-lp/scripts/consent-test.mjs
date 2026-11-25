// Testa o aviso de cookies: momento de aparecer, altura, barra fixa e gravação da escolha.
import puppeteer from 'puppeteer-core'
const [url, out] = process.argv.slice(2)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const SEL = '[aria-label="Aviso de cookies"]'
const banner = (p) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), height: Math.round(r.height) } }, SEL)
const sticky = (p) => p.evaluate(() => { const e = document.querySelector('[inert], .fixed.inset-x-0.bottom-0.z-50'); const el = document.querySelector('.fixed.inset-x-0.bottom-0.z-50'); return el ? { inert: el.hasAttribute('inert'), top: Math.round(el.getBoundingClientRect().top) } : null })
async function open(w) {
  const ctx = await b.createBrowserContext() // sessão limpa (sem escolha salva)
  const p = await ctx.newPage()
  const mobile = w < 768
  await p.setViewport({ width: w, height: mobile ? 844 : 900, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile })
  await p.goto(url, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => Object.keys(document.getElementById('root')).some((k) => k.startsWith('__react')))
  await p.evaluate(() => (document.documentElement.style.scrollBehavior = 'auto'))
  return p
}
const res = {}
// 1) sem rolar: não aparece aos 3 s; aparece até 6,5 s
let p = await open(390)
await wait(3000); res.aos3s = await banner(p)
await wait(3500); res.aos6_5s = await banner(p)
await p.screenshot({ path: `${out}/aviso-cookies-390.png` })
await p.close()
// 2) rolando: aparece logo
p = await open(390)
await wait(500); await p.evaluate(() => window.scrollTo(0, 300)); await wait(600)
res.aposRolar = await banner(p)
// 3) barra fixa escondida com o aviso na tela, mesmo depois do hero
await p.evaluate(() => window.scrollTo(0, document.getElementById('problema').offsetTop + 400)); await wait(900)
res.barraComAviso = await sticky(p)
// 4) "Aceitar": aviso some, barra volta, escolha gravada
await p.evaluate((s) => [...document.querySelectorAll(`${s} button`)].find((x) => x.textContent.trim() === 'Aceitar').click(), SEL)
await wait(800)
res.depoisAceitar = { aviso: await banner(p), barra: await sticky(p), salvo: await p.evaluate(() => localStorage.getItem('cs-consent')), consentNoDataLayer: await p.evaluate(() => JSON.stringify((window.dataLayer || []).filter((x) => x && x[0] === 'consent').map((x) => [x[1], x[2].analytics_storage]))) }
await p.close()
// 5) desktop
p = await open(1440)
await wait(6500); res.desktop = await banner(p)
await p.screenshot({ path: `${out}/aviso-cookies-1440.png` })
await p.close()
await b.close()
console.log(JSON.stringify(res, null, 1))
