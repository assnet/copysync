// Barra fixa do rodapé no celular (aparece depois do hero): print e medidas.
import puppeteer from 'puppeteer-core'
const [url = 'http://localhost:4173/', out = 'qa'] = process.argv.slice(2)
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
for (const w of [360, 390, 412, 430]) {
  const p = await b.newPage()
  await p.setViewport({ width: w, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await p.evaluateOnNewDocument(() => localStorage.setItem('cs-consent', 'denied'))
  await p.goto(url, { waitUntil: 'networkidle0' })
  await p.evaluate(() => scrollTo(0, 1600))
  await new Promise((r) => setTimeout(r, 900))
  const bar = await p.$('[data-bottom-bar="cta"]')
  console.log(w, await bar.evaluate((e) => ({ texto: e.innerText.replace(/\s+/g, ' '), altura: e.offsetHeight, larguraPagina: document.documentElement.scrollWidth })))
  const h = await bar.evaluate((e) => e.offsetHeight)
  await p.screenshot({ path: `${out}/barra-fixa-${w}-tela.png` })
  console.log('visível:', await bar.evaluate((e) => getComputedStyle(e).transform), 'altura', h)
  await p.close()
}
await b.close()
