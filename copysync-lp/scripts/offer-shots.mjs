// Capturas do topo dos planos (selo do anual + trava de preço), do fechamento, do FAQ e da cláusula de preço dos Termos.
import puppeteer from 'puppeteer-core'
const [url = 'http://localhost:4173/', out = 'qa'] = process.argv.slice(2)
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
for (const w of [390, 1440]) {
  const m = w < 768
  const p = await (await b.createBrowserContext()).newPage()
  await p.setViewport({ width: w, height: 900, deviceScaleFactor: m ? 2 : 1, isMobile: m, hasTouch: m })
  await p.evaluateOnNewDocument(() => localStorage.setItem('cs-consent', 'denied'))
  await p.goto(url, { waitUntil: 'networkidle0' })
  await p.addStyleTag({ content: '[data-bottom-bar]{display:none!important}' })
  await (await p.$('#planos > div > div')).screenshot({ path: `${out}/planos-topo-${w}.png` })
  await (await p.$('#fechamento')).screenshot({ path: `${out}/fechamento-${w}.png` })
  await p.evaluate(() => {
    for (const d of document.querySelectorAll('#faq details')) d.open = d.querySelector('summary').textContent.includes('preço pode')
  })
  await new Promise((r) => setTimeout(r, 400))
  await (await p.$('#faq')).screenshot({ path: `${out}/faq-${w}.png` })
  console.log(
    w,
    await p.evaluate(() => ({
      selo: document.querySelector('#planos [role=radio][aria-checked=true]').textContent,
      largura: document.documentElement.scrollWidth,
      alternador: Math.round(document.querySelector('#planos [role=radiogroup]').getBoundingClientRect().width),
      travas: [...document.querySelectorAll('p')].filter((x) => x.textContent.includes('Preço travado')).length,
      faq: document.querySelectorAll('#faq details').length,
    })),
  )
  const t = await (await b.createBrowserContext()).newPage()
  await t.setViewport({ width: w, height: 900, deviceScaleFactor: m ? 2 : 1, isMobile: m })
  await t.goto(new URL('termos/', url).href, { waitUntil: 'networkidle0' })
  const h = await t.$$('h2')
  await h[5].evaluate((e) => e.scrollIntoView({ block: 'start' }))
  await t.evaluate(() => scrollBy(0, -80))
  await t.screenshot({ path: `${out}/termos-preco-${w}.png` })
}
await b.close()
