// Quadros da animação do hero (390x740) em instantes fixos, para conferir a sequência.
import puppeteer from 'puppeteer-core'
const [url = 'http://localhost:4173/', out = 'qa/hero'] = process.argv.slice(2)
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const p = await b.newPage()
await p.setViewport({ width: 390, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await p.goto(url, { waitUntil: 'networkidle0' })
const stage = await p.$('.swap-stage')
for (const t of [200, 900, 1900, 2500, 3300, 4600, 5800]) {
  await p.evaluate((t) => document.getAnimations().filter((a) => a.effect?.target?.closest?.('.swap-stage')).forEach((a) => { a.pause(); a.currentTime = t }), t)
  await stage.screenshot({ path: `${out}/frame-${String(t).padStart(4, '0')}.png` })
}
await b.close()
