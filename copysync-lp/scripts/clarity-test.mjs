// Teste do Microsoft Clarity: nada do Clarity antes do "Aceitar" (nem pedidos nem cookies); depois do aceite ele carrega;
// com aceite salvo, carrega só depois do "load"; com recusa salva, nunca carrega.
import puppeteer from 'puppeteer-core'
const [base = 'http://localhost:4173/'] = process.argv.slice(2)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
// todos os cookies do navegador (inclusive de terceiros) que vêm do Clarity / Microsoft
const clarityCookies = async (p) => {
  const all = (await p.browserContext().cookies?.()) ?? (await p.cookies())
  return all.filter((c) => /^_cl|^CLID$|^MUID$|^ANONCHK$|^SM$|^MR$/.test(c.name)).map((c) => `${c.name}@${c.domain}`)
}
const consentStatus = (p) =>
  p.evaluate(() => new Promise((res) => {
    try { window.clarity('metadata', (d, upgrade, consent) => res(JSON.stringify(consent ?? null)), false, true, true) } catch { res('erro') }
    setTimeout(() => res('sem resposta'), 4000)
  }))

async function visit(saved) {
  const p = await (await b.createBrowserContext()).newPage()
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  if (saved) await p.evaluateOnNewDocument((c) => localStorage.setItem('cs-consent', c), saved)
  const reqs = []
  p.on('request', (r) => { if (/clarity\.ms/.test(r.url())) reqs.push({ url: r.url(), t: Date.now() }) })
  const t0 = Date.now()
  await p.goto(base, { waitUntil: 'load' })
  const tLoad = Date.now()
  await wait(6000)
  const tag = reqs.find((r) => r.url.includes('/tag/zgmja8fnyk'))
  return { p, reqs, tag, t0, tLoad }
}

// 1) primeira visita, sem escolha
{
  const { p, reqs, tag, tLoad } = await visit(null)
  console.log('1) primeira visita, sem escolha')
  console.log('   pedidos ao Clarity antes do Aceitar:', reqs.length, '· cookies do Clarity/Microsoft:', (await clarityCookies(p)).join(',') || 'nenhum')
  await p.evaluate(() => scrollTo(0, 300))
  await p.waitForFunction(() => [...document.querySelectorAll('button')].some((x) => x.textContent.trim() === 'Aceitar'), { timeout: 10000 })
  await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Aceitar').click())
  await wait(4000)
  console.log('   depois do Aceitar: script pedido', reqs.some((r) => r.url.includes('/tag/zgmja8fnyk')), '· collect', reqs.filter((r) => r.url.includes('collect')).length)
  console.log('   depois do Aceitar: cookies', (await clarityCookies(p)).join(',') || 'nenhum', '· consentimento:', await consentStatus(p))
  console.log('   GA4/Ads continuam:', (await p.cookies()).map((c) => c.name).filter((n) => /^_ga|^_gcl/.test(n)).join(','))
  await p.close()
}
// 2) e 3) visitas com escolha salva
for (const saved of ['granted', 'denied']) {
  const { p, reqs, tag, tLoad } = await visit(saved)
  console.log(`${saved === 'granted' ? '2' : '3'}) visita com "${saved === 'granted' ? 'Aceitar' : 'Recusar'}" salvo:`, tag ? `script pedido ${tag.t - tLoad} ms depois do load` : `pedidos ao Clarity: ${reqs.length}`, '· cookies', (await clarityCookies(p)).join(',') || 'nenhum', saved === 'granted' ? '· consentimento: ' + (await consentStatus(p)) : '')
  await p.close()
}
// 4) campos mascarados: rodapé com telefone e CNPJ
{
  const p = await (await b.createBrowserContext()).newPage()
  await p.goto(base, { waitUntil: 'load' })
  console.log('4) elementos com data-clarity-mask:', await p.evaluate(() => [...document.querySelectorAll('[data-clarity-mask]')].map((e) => e.textContent.replace(/\s+/g, ' ').slice(0, 60)).join(' | ')))
  console.log('   campos de formulário na página:', await p.evaluate(() => document.querySelectorAll('input, textarea, select').length))
  await p.close()
}
await b.close()
