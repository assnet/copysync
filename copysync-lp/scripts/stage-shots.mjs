// Capturas do hero (primeira tela) e do palco dos recursos, no celular e no desktop; também com "reduzir movimento".
import puppeteer from 'puppeteer-core'
const [url, out] = process.argv.slice(2)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
async function page(w, reduce) {
  const mobile = w < 768
  const p = await (await b.createBrowserContext()).newPage()
  await p.setViewport({ width: w, height: mobile ? 844 : 900, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile })
  if (reduce) await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await p.evaluateOnNewDocument(() => localStorage.setItem('cs-consent', 'denied'))
  await p.goto(url, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => Object.keys(document.getElementById('root')).some((k) => k.startsWith('__react')))
  await p.evaluate(() => (document.documentElement.style.scrollBehavior = 'auto'))
  return p
}
for (const w of [390, 1440]) {
  const p = await page(w)
  if (w > 1000) await p.mouse.move(300, 300)
  await wait(4800)
  await p.screenshot({ path: `${out}/hero-${w}.png` })
  // headline e celular não podem ficar cobertos pelos cartões
  const overlap = await p.evaluate(() => {
    const h1 = document.getElementById('hero-title').getBoundingClientRect()
    const cards = [...document.querySelectorAll('[data-floating] > div')].map((d) => d.getBoundingClientRect())
    const phone = document.querySelector('#topo [class*="perspective:1600px"]').getBoundingClientRect()
    const hit = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom)
    // compara com as linhas do texto (a caixa do h1 ocupa a coluna inteira, além do fim das linhas)
    const r = document.createRange(); r.selectNodeContents(document.getElementById('hero-title'))
    const lines = [...r.getClientRects()]
    return { cartoes: cards.length, cobreHeadline: cards.some((c) => lines.some((l) => hit(c, l))), headlineBottom: Math.round(h1.bottom), cartoes_topo: cards.map((c) => Math.round(c.top)), larguraPagina: document.documentElement.scrollWidth }
  })
  console.log(w, 'hero', JSON.stringify(overlap))
  // palco: contador antes/depois de entrar
  const before = await p.evaluate(() => document.querySelector('#recursos .tabular-nums span').textContent)
  await p.evaluate(() => document.getElementById('recursos').scrollIntoView({ block: 'start' }))
  await wait(250)
  const mid = await p.evaluate(() => document.querySelector('#recursos .tabular-nums span').textContent)
  await wait(2200)
  const after = await p.evaluate(() => document.querySelector('#recursos .tabular-nums span').textContent)
  console.log(w, 'contador', { antesDeEntrar: before, logoAoEntrar: mid, depois: after })
  await p.evaluate(() => window.scrollBy(0, -40))
  await wait(300)
  await p.screenshot({ path: `${out}/palco-topo-${w}.png` })
  const el = await p.$('#recursos')
  // rola por todo o palco para os cartões terminarem de entrar, depois captura inteiro
  const h = await p.evaluate(() => document.getElementById('recursos').offsetHeight)
  for (let y = 0; y < h; y += 300) { await p.evaluate((d) => window.scrollTo(0, document.getElementById('recursos').offsetTop + d), y); await wait(120) }
  await wait(1500)
  if (w > 1000) await p.mouse.move(1000, 450)
  await el.screenshot({ path: `${out}/palco-${w}.png` })
  const cta = await p.evaluate(() => { const a = [...document.querySelectorAll('#recursos a')].find((x) => x.textContent.includes('Ver planos')); return a && a.getAttribute('href') })
  console.log(w, 'cta', cta)
  await p.browserContext().close()
}
// reduzir movimento: nada inclinado, contador parado em 156
const p = await page(390, true)
const r = await p.evaluate(() => ({
  contador: document.querySelector('#recursos .tabular-nums span').textContent,
  cartoes: [...document.querySelectorAll('[data-tilt]')].map((li) => li.style.transform || 'none'),
  flutuantes: [...document.querySelectorAll('[data-floating]')].map((d) => d.style.transform || 'none'),
}))
console.log('reduzir movimento', JSON.stringify(r))
await b.close()
