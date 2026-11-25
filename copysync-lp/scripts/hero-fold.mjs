// Primeira tela do hero: o que aparece sem rolar em cada altura de tela (390 de largura) e no desktop.
// Uso: node scripts/hero-fold.mjs [url] [pasta] [tempo-da-animação-em-ms]
import puppeteer from 'puppeteer-core'
const [url = 'http://localhost:4173/', out = 'qa/hero', at = '4000'] = process.argv.slice(2)
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const sizes = [
  [390, 844, 'tela cheia 390x844'],
  [390, 740, 'app do YouTube (barra no topo)'],
  [390, 664, 'Safari com as barras'],
  [390, 640, 'pior caso'],
  [360, 640, 'Android pequeno'],
  [768, 1024, 'tablet'],
  [1440, 900, 'desktop'],
]
for (const [w, h, label] of sizes) {
  const m = w < 768
  const p = await (await b.createBrowserContext()).newPage()
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: m, hasTouch: m })
  await p.goto(url, { waitUntil: 'networkidle0' })
  // congela a animação num instante fixo para o print
  await p.evaluate((t) => document.getAnimations().filter((a) => a.effect?.target?.closest?.('.swap-stage')).forEach((a) => { a.pause(); a.currentTime = t }), Number(at))
  const r = await p.evaluate(() => {
    const q = (s) => document.querySelector(s)
    const hero = q('#topo')
    const box = (el) => el && Math.round(el.getBoundingClientRect().bottom)
    const h1 = q('#hero-title')
    const lines = new Set([...(() => { const rg = document.createRange(); rg.selectNodeContents(h1); return rg.getClientRects() })()].map((r) => Math.round(r.top))).size
    const links = [...hero.querySelectorAll('a')]
    return {
      selo: box(hero.querySelector('ul')),
      titulo: box(h1),
      linhasTitulo: lines,
      subtitulo: box(h1.nextElementSibling),
      animacao: box(q('.swap-stage')),
      alturaAnimacao: Math.round(q('.swap-stage').getBoundingClientRect().height),
      botao: box(links.find((a) => a.textContent.includes('Quero meu grupo'))),
      preco: box(links.find((a) => a.textContent.includes('Planos a partir'))),
      verComo: box(links.find((a) => a.textContent.includes('Ver como funciona'))),
      tela: innerHeight,
      larguraPagina: document.documentElement.scrollWidth,
    }
  })
  const fits = ['selo', 'titulo', 'subtitulo', 'animacao', 'botao', 'preco'].every((k) => r[k] <= r.tela)
  console.log(`${w}x${h} (${label}): cabe sem rolar=${fits}`, JSON.stringify(r))
  await p.screenshot({ path: `${out}/hero-${w}x${h}.png` })
  await p.close()
}
await b.close()
