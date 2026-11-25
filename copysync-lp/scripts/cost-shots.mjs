// Capturas do bloco de custo, do topo/garantia dos planos e do fechamento (390 e 1440) + checagens de ordem e período.
import puppeteer from 'puppeteer-core'
const [url = 'http://localhost:4173/', out = 'qa'] = process.argv.slice(2)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
for (const w of [390, 1440]) {
  const mobile = w < 768
  const p = await (await b.createBrowserContext()).newPage()
  await p.setViewport({ width: w, height: mobile ? 844 : 900, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile })
  await p.evaluateOnNewDocument(() => localStorage.setItem('cs-consent', 'denied'))
  await p.goto(url, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => Object.keys(document.getElementById('root')).some((k) => k.startsWith('__react')))
  // rola a página toda para os efeitos de entrada terminarem
  for (let y = 0; y < 30000; y += 600) { await p.evaluate((y) => window.scrollTo(0, y), y); await wait(60) }
  await p.addStyleTag({ content: '[data-bottom-bar]{display:none!important}' })
  const info = await p.evaluate(() => {
    const cards = [...document.querySelectorAll('#planos article')].map((a) => ({ name: a.getAttribute('aria-label'), top: Math.round(a.getBoundingClientRect().top + scrollY), left: Math.round(a.getBoundingClientRect().left) }))
    const visual = [...cards].sort((a, b) => a.top - b.top || a.left - b.left).map((c) => c.name)
    const sections = [...document.querySelectorAll('main > section')].map((s) => s.id)
    const annual = document.querySelector('#planos [role=radio][aria-checked=true]')?.textContent
    const hrefs = [...document.querySelectorAll('#planos article a')].map((a) => a.getAttribute('href').split('/').pop())
    return { ordemVisual: visual, secoes: sections.join(' > '), periodo: annual, checkouts: hrefs, larguraPagina: document.documentElement.scrollWidth, selo: !!document.querySelector('#planos article span.uppercase')?.textContent.match(/Mais escolhido/i) }
  })
  console.log(w, JSON.stringify(info))
  for (const [sel, name] of [['#custo', 'custo'], ['#planos', 'planos'], ['#fechamento', 'fechamento']]) {
    const el = await p.$(sel)
    await el.screenshot({ path: `${out}/${name}-${w}.png` })
  }
  await p.close()
}
await b.close()
