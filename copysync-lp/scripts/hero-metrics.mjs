// Mede a linha de identificação e onde o celular animado começa na primeira tela.
import puppeteer from 'puppeteer-core'
const [url, w] = [process.argv[2], Number(process.argv[3] ?? 390)]
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const p = await b.newPage()
const mobile = w < 768
await p.setViewport({ width: w, height: mobile ? 844 : 900, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile })
await p.evaluateOnNewDocument(() => { try { localStorage.setItem('cs-consent', 'denied') } catch {} })
await p.goto(url, { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 1500))
const m = await p.evaluate(() => {
  const r = (el) => el && el.getBoundingClientRect()
  const id = document.querySelector('[class*="grid-area:id"]')
  const phone = document.querySelector('[class*="grid-area:visual"]')
  const h1 = document.getElementById('hero-title')
  const stage = phone.querySelector('[role="img"] > div')
  const screen = phone.querySelector('[role="img"]')
  const sc = r(screen), st = r(stage)
  const scale = st.width / 360
  // até que y da cena (palco 360×640) dá para ver sem rolar
  const stageVisibleTo = Math.round((Math.min(innerHeight, sc.bottom) - st.top) / scale)
  const parts = ['header', '[class*="grid-area:title"]', '[class*="grid-area:copy"] > p', '[class*="grid-area:copy"] a']
    .map((q) => { const e = document.querySelector('#topo ' + q); const b = r(e); return [q.slice(0, 26), Math.round(b.top), Math.round(b.bottom)] })
  const imgs = [...id.querySelectorAll('img')].map((i) => [i.alt, Math.round(r(i.parentElement).width), Math.round(r(i.parentElement).top)])
  return { idTop: Math.round(r(id).top), idBottom: Math.round(r(id).bottom), h1Bottom: Math.round(r(h1).bottom), phoneTop: Math.round(r(phone).top), visibleOfPhone: Math.max(0, innerHeight - Math.round(r(phone).top)), screenTop: Math.round(sc.top), scale: +scale.toFixed(3), stageVisibleTo, parts, viewport: innerHeight, docW: document.documentElement.scrollWidth, logos: imgs }
})
console.log(JSON.stringify(m))
await b.close()
