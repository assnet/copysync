// Teste da tag do Google: Consent Mode (negado → "Aceitar"), GA4/Ads carregando, evento clique_assinar,
// repasse de gclid/gbraid/wbraid/utm_* e linker (_gl) nos links da Cakto. Navegação para a Cakto é bloqueada.
import puppeteer from 'puppeteer-core'
const [base = 'http://localhost:4173/'] = process.argv.slice(2)
const url = base + '?utm_source=google&utm_medium=cpc&utm_campaign=teste&gclid=TESTEgclid123&gbraid=TESTEgb&wbraid=TESTEwb'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const p = await (await b.createBrowserContext()).newPage()
await p.setViewport({ width: 1440, height: 900 })
const hits = []
await p.setRequestInterception(true)
p.on('request', (r) => {
  const u = r.url()
  if (/google-analytics\.com\/(g\/)?collect|googletagmanager\.com\/gtag|googleads|doubleclick|google\.com\/(ccm|pagead|rmkt)/.test(u)) hits.push(u)
  if (u.includes('pay.cakto.com.br')) { hits.push('NAVEGACAO→ ' + u); return r.abort() }
  r.continue()
})
const ga = (filter) => hits.filter((u) => u.includes('/g/collect') && (!filter || u.includes(filter)))
const param = (u, k) => new URL(u).searchParams.get(k)

await p.goto(url, { waitUntil: 'networkidle0' })
await wait(1500)
const cookiesAntes = (await p.cookies()).map((c) => c.name)
console.log('1) gtag.js carregado:', hits.some((u) => u.includes('gtag/js?id=G-C0DJZKPX9S')))
console.log('   page_view GA4 antes do aceite:', ga('en=page_view').map((u) => `gcs=${param(u, 'gcs')} tid=${param(u, 'tid')}`).join(' | ') || 'nenhum')
console.log('   cookies _ga antes do aceite:', cookiesAntes.filter((n) => n.startsWith('_ga') || n.startsWith('_gcl')).join(',') || 'nenhum')
console.log('   Google Ads (AW-18410182876) chamado:', hits.some((u) => u.includes('18410182876')))

// aceitar no aviso de cookies
await p.evaluate(() => scrollTo(0, 200))
await p.waitForFunction(() => [...document.querySelectorAll('button')].some((x) => x.textContent.trim() === 'Aceitar'), { timeout: 10000 })
await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Aceitar').click())
await wait(2500)
const cookiesDepois = (await p.cookies()).map((c) => c.name)
console.log('2) depois do Aceitar: cookies', cookiesDepois.filter((n) => n.startsWith('_ga') || n.startsWith('_gcl')).join(',') || 'nenhum')
console.log('   hits GA4 imediatos após o aceite (o GA4 manda no próximo evento):', ga().filter((u) => param(u, 'gcs') === 'G111').length)

// links da Cakto
const links = await p.evaluate(() => [...document.querySelectorAll('a[href*="pay.cakto.com.br"]')].map((a) => a.href))
const okParams = links.every((h) => ['gclid', 'gbraid', 'wbraid', 'utm_source', 'utm_medium', 'utm_campaign'].every((k) => new URL(h).searchParams.has(k)))
console.log('3) links da Cakto:', links.length, '· com gclid/gbraid/wbraid/utm_*:', okParams)

// clique no "Assinar PRO" (anual) → evento + linker
await p.evaluate(() => document.querySelector('#planos').scrollIntoView())
await wait(500)
const pro = await p.evaluateHandle(() => [...document.querySelectorAll('#planos a')].find((a) => a.textContent.includes('Assinar PRO')))
await pro.click()
await wait(2500)
const ev = ga('en=clique_assinar')
console.log('4) clique_assinar no GA4:', ev.map((u) => `plano=${param(u, 'ep.plano')} periodo=${param(u, 'ep.periodo')} tid=${param(u, 'tid')} gcs=${param(u, 'gcs')}`).join(' | ') || 'NÃO ENVIADO')
const nav = hits.find((u) => u.startsWith('NAVEGACAO'))
if (nav) {
  const nu = new URL(nav.replace('NAVEGACAO→ ', ''))
  console.log('5) checkout aberto:', nu.pathname, '· gclid', nu.searchParams.get('gclid'), '· utm_source', nu.searchParams.get('utm_source'), '· _gl (linker):', nu.searchParams.has('_gl') ? 'sim' : 'não')
}
// a navegação bloqueada deixou a aba numa página de erro: recarrega (o aceite fica salvo)
await p.goto(url, { waitUntil: 'networkidle0' })
await wait(1500)
console.log('   recarregada com aceite salvo: page_views', ga('en=page_view').map((u) => param(u, 'gcs')).join(', '), '· cs-consent=', await p.evaluate(() => localStorage.getItem('cs-consent')))
// mensal: troca a chave e clica no LITE (clique do meio não navega a página)
await p.evaluate(() => [...document.querySelectorAll('#planos [role=radio]')].find((x) => x.textContent.startsWith('Mensal')).click())
await wait(300)
await p.evaluate(() => {
  const a = [...document.querySelectorAll('#planos a')].find((x) => x.textContent.includes('Assinar LITE'))
  a.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }))
})
await wait(2000)
console.log('6) clique do meio (nova aba), LITE mensal:', ga('en=clique_assinar').slice(-1).map((u) => `plano=${param(u, 'ep.plano')} periodo=${param(u, 'ep.periodo')}`).join('') || 'NÃO ENVIADO')
await b.close()
