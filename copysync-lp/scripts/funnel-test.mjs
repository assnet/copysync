// Funil anônimo (/b.gif): os 4 eventos disparam uma vez cada, sem cookies, sem Referer, sem localStorage,
// e o clique para a Cakto não é atrasado. Rode contra o Apache local (com o .htaccess) ou o vite preview.
// Uso: node scripts/funnel-test.mjs [base]
import puppeteer from 'puppeteer-core'
const [base = 'http://127.0.0.1:8088/'] = process.argv.slice(2)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })

async function run(label, consent) {
  const ctx = await b.createBrowserContext()
  const p = await ctx.newPage()
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  if (consent) await p.evaluateOnNewDocument((c) => localStorage.setItem('cs-consent', c), consent)
  const cdp = await p.createCDPSession()
  await cdp.send('Network.enable')
  const beacons = new Map() // requestId → info
  const t0 = Date.now()
  cdp.on('Network.requestWillBeSent', (e) => {
    if (e.request.url.includes('/b.gif')) beacons.set(e.requestId, { url: e.request.url, t: Date.now() - t0, method: e.request.method, referer: e.request.headers.Referer ?? null })
  })
  cdp.on('Network.requestWillBeSentExtraInfo', (e) => {
    const x = beacons.get(e.requestId)
    if (x) x.cookie = e.headers.Cookie ?? e.headers.cookie ?? null
  })
  cdp.on('Network.responseReceivedExtraInfo', (e) => {
    const x = beacons.get(e.requestId)
    if (x) Object.assign(x, { status: e.statusCode, setCookie: e.headers['Set-Cookie'] ?? e.headers['set-cookie'] ?? null, cache: e.headers['Cache-Control'] ?? e.headers['cache-control'] })
  })
  let caktoAt = 0
  await p.setRequestInterception(true)
  p.on('request', (r) => {
    if (r.url().includes('pay.cakto.com.br') && r.isNavigationRequest()) { caktoAt = Date.now() - t0; return r.respond({ status: 200, contentType: 'text/html', body: '<p>cakto (simulado)</p>' }) }
    r.continue()
  })
  const allCookies = async () => (await cdp.send('Network.getAllCookies')).cookies.map((c) => `${c.name}@${c.domain}`)

  await p.goto(base + '?utm_source=google&utm_medium=cpc&utm_campaign=teste&utm_content=video_b&gclid=TESTEgclid', { waitUntil: 'load' })
  await wait(1200)
  const cookiesStart = await allCookies()
  const lsStart = await p.evaluate(() => Object.keys(localStorage))
  await wait(4500) // 5 s com a aba visível
  // rola até 60% e mais um pouco (scroll50 só uma vez)
  for (const f of [0.3, 0.6, 0.8, 0.55]) { await p.evaluate((f) => scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * f), f); await wait(400) }
  const cookiesBefore = await allCookies()
  const lsBefore = await p.evaluate(() => Object.keys(localStorage))
  // clique do meio (não navega) + clique normal no "Assinar PRO": assinar só uma vez; a navegação segue na hora
  await p.evaluate(() => document.querySelector('#planos').scrollIntoView())
  await wait(300)
  await p.evaluate(() => [...document.querySelectorAll('#planos a')].find((a) => a.textContent.includes('Assinar LITE')).dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 })))
  const clickAt = Date.now() - t0
  const pro = await p.evaluateHandle(() => [...document.querySelectorAll('#planos a')].find((a) => a.textContent.includes('Assinar PRO')))
  const clickProAt = Date.now() - t0
  await pro.click()
  await wait(1500)
  const list = [...beacons.values()]
  const ev = (u) => new URL(u, base).searchParams
  console.log(`\n== ${label}`)
  for (const x of list) {
    const q = ev(x.url)
    console.log(`  ${q.get('e').padEnd(8)} c=${q.get('c') || '(vazio)'} r=${q.get('r')} · ${x.method} ${x.status} · ${x.t} ms · Cookie enviado: ${x.cookie ?? 'nenhum'} · Referer: ${x.referer ?? 'nenhum'} · Set-Cookie: ${x.setCookie ?? 'nenhum'} · Cache-Control: ${x.cache}`)
  }
  const counts = Object.fromEntries(['load', 'stay5', 'scroll50', 'assinar'].map((k) => [k, list.filter((x) => ev(x.url).get('e') === k).length]))
  console.log('  vezes por evento:', JSON.stringify(counts))
  console.log('  r diferentes:', new Set(list.map((x) => ev(x.url).get('r'))).size, 'de', list.length)
  console.log(`  cookies ao abrir: ${cookiesStart.join(', ') || 'nenhum'} · antes do clique: ${cookiesBefore.join(', ') || 'nenhum'}`)
  console.log(`  localStorage: ao abrir [${lsStart}] · antes do clique [${lsBefore}]`)
  const assinar = list.find((x) => ev(x.url).get('e') === 'assinar')
  console.log(`  clique no PRO em ${clickProAt} ms → Cakto pedida em ${caktoAt} ms (assinar já tinha saído no clique do meio em ${assinar?.t} ms, clique do meio em ${clickAt} ms)`)
  await ctx.close()
}

// 3) sem clique do meio: o "assinar" sai no clique normal e a navegação não espera
async function runClickOnly() {
  const ctx = await b.createBrowserContext()
  const p = await ctx.newPage()
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
  const t0 = Date.now()
  const seen = []
  await p.setRequestInterception(true)
  p.on('request', (r) => {
    if (r.url().includes('/b.gif?e=assinar')) seen.push(['assinar', Date.now() - t0])
    if (r.url().includes('pay.cakto.com.br') && r.isNavigationRequest()) { seen.push(['cakto', Date.now() - t0]); return r.respond({ status: 200, contentType: 'text/html', body: 'ok' }) }
    r.continue()
  })
  await p.goto(base, { waitUntil: 'load' })
  await p.evaluate(() => document.querySelector('#planos').scrollIntoView())
  await wait(300)
  const a = await p.evaluateHandle(() => [...document.querySelectorAll('#planos a')].find((a) => a.textContent.includes('Assinar MAX')))
  const tc = Date.now() - t0
  await a.click()
  await wait(1500)
  console.log(`\n== só clique normal (MAX): clique em ${tc} ms · ${seen.map(([k, t]) => `${k} em ${t} ms`).join(' · ')} · página agora: ${p.url().slice(0, 40)}`)
  await ctx.close()
}

await run('1) visitante novo, sem escolher no aviso de cookies', null)
await run('2) visitante que já aceitou os cookies (o GA4 tem cookies; o b.gif não deve levá-los)', 'granted')
await runClickOnly()
await b.close()
