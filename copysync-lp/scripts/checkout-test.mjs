// Testa os 6 botões de checkout: anual por padrão, mensal pela chave, UTMs repassadas e eventos plan_select/checkout_start.
import puppeteer from 'puppeteer-core'
import { readFileSync } from 'node:fs'
const [url, out] = process.argv.slice(2)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const EXPECT = { LITE: { anual: 'a92kn9k_1291217', mensal: '8e4gepk_1291207' }, PRO: { anual: 'f34qfgh_1291232', mensal: 'fronsgu_1291227' }, MAX: { anual: '97nqcb8_1291245', mensal: 'kzoagvc_1291239' } }
// 1) HTML pré-renderizado (antes do JS): já sai no anual
const html = readFileSync('dist/index.html', 'utf8')
const ssr = Object.fromEntries(Object.entries(EXPECT).map(([k, v]) => [k, html.includes(v.anual) && !html.includes(v.mensal) ? 'anual' : 'ERRO']))
console.log('HTML inicial (sem JS):', JSON.stringify(ssr))
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const p = await (await b.createBrowserContext()).newPage()
await p.setViewport({ width: 1440, height: 900 })
await p.evaluateOnNewDocument(() => localStorage.setItem('cs-consent', 'denied'))
await p.goto(url + '?utm_source=google&utm_campaign=teste&gclid=abc123', { waitUntil: 'networkidle0' })
await p.waitForFunction(() => Object.keys(document.getElementById('root')).some((k) => k.startsWith('__react')))
await p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; window.addEventListener('click', (e) => { if (e.target.closest('a[href*="cakto"]')) e.preventDefault() }, true) })
await p.evaluate(() => document.getElementById('planos').scrollIntoView())
await wait(600)
const state = () => p.evaluate(() => {
  const toggle = [...document.querySelectorAll('#planos button')].filter((x) => /^(Mensal|Anual)/.test(x.textContent.trim())).map((x) => `${x.textContent.trim().split(/\s/)[0]}:${x.getAttribute('aria-pressed') ?? x.getAttribute('aria-checked') ?? x.className.includes('text-white')}`)
  const links = [...document.querySelectorAll('#planos a[href*="cakto"]')].map((a) => ({ txt: a.textContent.trim(), href: a.href }))
  return { toggle, links }
})
async function clickAll(periodo) {
  const s = await state()
  const rows = []
  for (const l of s.links) {
    const plano = l.txt.replace('Assinar', '').trim()
    const before = await p.evaluate(() => (window.dataLayer || []).length)
    await p.evaluate((h) => document.querySelector(`#planos a[href="${h}"]`).click(), l.href)
    await wait(100)
    const ev = await p.evaluate((n) => (window.dataLayer || []).slice(n).filter((x) => x && x.event), before)
    const u = new URL(l.href)
    rows.push({
      botao: l.txt,
      checkout: u.pathname.slice(1),
      certo: u.pathname.slice(1) === EXPECT[plano][periodo] ? 'ok' : 'ERRO',
      utm: u.searchParams.get('utm_source') === 'google' && u.searchParams.get('gclid') === 'abc123' ? 'ok' : 'ERRO',
      eventos: ev.map((e) => `${e.event}(${e.plano},${e.periodo})`).join(' '),
      periodoEvento: ev.every((e) => e.periodo === periodo) && ev.length === 2 ? 'ok' : 'ERRO',
    })
  }
  console.log(`\n${periodo.toUpperCase()} · chave: ${s.toggle.join(' ')}`)
  console.table(rows)
}
await p.screenshot({ path: `${out}/planos-anual-1440.png` })
await clickAll('anual')
await p.evaluate(() => [...document.querySelectorAll('#planos button')].find((x) => x.textContent.trim().startsWith('Mensal')).click())
await wait(500)
await clickAll('mensal')
await p.evaluate(() => [...document.querySelectorAll('#planos button')].find((x) => x.textContent.trim().startsWith('Anual')).click())
await wait(500)
const back = await state()
console.log('\nDe volta ao anual:', back.links.map((l) => new URL(l.href).pathname.slice(1)).join(', '))
await b.close()
