// stay5 só conta tempo com a aba visível: abre "escondida" 7 s (não dispara), mostra 3 s (não dispara), esconde, mostra de novo 2,5 s (dispara).
import puppeteer from 'puppeteer-core'
const [base = 'http://127.0.0.1:8088/'] = process.argv.slice(2)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const p = await b.newPage()
await p.evaluateOnNewDocument(() => {
  let v = 'hidden'
  Object.defineProperty(document, 'visibilityState', { get: () => v })
  Object.defineProperty(document, 'hidden', { get: () => v === 'hidden' })
  window.__setVis = (x) => { v = x; document.dispatchEvent(new Event('visibilitychange')) }
})
const hits = []
const t0 = Date.now()
p.on('request', (r) => r.url().includes('e=stay5') && hits.push(Date.now() - t0))
await p.goto(base, { waitUntil: 'load' })
await wait(7000); console.log('7 s escondida → stay5:', hits.length)
await p.evaluate(() => __setVis('visible')); await wait(3000); console.log('+3 s visível → stay5:', hits.length)
await p.evaluate(() => __setVis('hidden')); await wait(4000); console.log('+4 s escondida → stay5:', hits.length)
await p.evaluate(() => __setVis('visible')); await wait(2500); console.log('+2,5 s visível (5,5 s visíveis no total) → stay5:', hits.length)
await b.close()
