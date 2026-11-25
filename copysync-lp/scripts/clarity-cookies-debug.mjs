// Quais respostas do Clarity/Microsoft gravam cookies (Set-Cookie) numa primeira visita sem aceite.
import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const p = await (await b.createBrowserContext()).newPage()
const cdp = await p.createCDPSession()
await cdp.send('Network.enable')
const urls = new Map()
cdp.on('Network.requestWillBeSent', (e) => urls.set(e.requestId, e.request.url))
cdp.on('Network.responseReceivedExtraInfo', (e) => {
  const sc = Object.entries(e.headers).filter(([k]) => k.toLowerCase() === 'set-cookie').map(([, v]) => v).join(' ;; ')
  const u = urls.get(e.requestId) || '?'
  if (sc && /clarity|bing/.test(u)) console.log(u.split('?')[0], '→', sc.split('\n').map((c) => c.split('=')[0]).join(', '))
})
await p.goto(process.argv[2] || 'http://localhost:4173/', { waitUntil: 'load' })
await new Promise((r) => setTimeout(r, 7000))
await b.close()
