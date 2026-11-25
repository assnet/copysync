// Visita com o aceite já salvo: o page_view tem de sair com consentimento (gcs=G111) desde o início.
import puppeteer from 'puppeteer-core'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
for (const c of ['granted', 'denied']) {
  const p = await (await b.createBrowserContext()).newPage()
  const hits = []
  p.on('request', (r) => { if (r.url().includes('/g/collect')) hits.push(r.url()) })
  await p.evaluateOnNewDocument((c) => localStorage.setItem('cs-consent', c), c)
  await p.goto('http://localhost:4173/?gclid=X', { waitUntil: 'networkidle0' })
  await wait(4000)
  console.log(`aceite salvo = ${c}:`, hits.map((u) => { const s = new URL(u).searchParams; return `${s.get('en')} gcs=${s.get('gcs')}` }).join(' | ') || 'nenhum hit', '· cookies:', (await p.cookies()).map((x) => x.name).filter((n) => /^_g/.test(n)).join(',') || 'nenhum')
}
await b.close()
