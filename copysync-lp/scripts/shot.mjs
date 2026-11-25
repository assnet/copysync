// Capturas de QA com o Chrome instalado.
// uso: node scripts/shot.mjs <url> <saida.png> <largura> [--full] [--selector=#id] [--wait=ms] [--scale=2]
import puppeteer from 'puppeteer-core'

const [url, out, widthArg, ...rest] = process.argv.slice(2)
const opts = Object.fromEntries(rest.map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
const width = Number(widthArg)
const mobile = width < 768
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const page = await browser.newPage()
await page.setViewport({ width, height: mobile ? 844 : 900, deviceScaleFactor: Number(opts.scale ?? (mobile ? 2 : 1)), isMobile: mobile, hasTouch: mobile })
if (opts.consent) await page.evaluateOnNewDocument(() => { try { localStorage.setItem('cs-consent', 'denied') } catch {} })
if (opts.reduce) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
await page.goto(url, { waitUntil: 'networkidle0' })
await page.evaluate(() => document.fonts.ready)
if (opts.open) await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)))

// Rola a página inteira devagar para disparar as animações por scroll / entrada na tela.
if (opts.full || opts.selector) {
  await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = 'auto'
    const step = innerHeight / 2
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 450))
    }
  })
  await new Promise((r) => setTimeout(r, 8000)) // termina corrida do Bloco 2, etc.
}

if (opts.selector) {
  await page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'start' }), opts.selector)
  await new Promise((r) => setTimeout(r, Number(opts.wait ?? 800)))
  const el = await page.$(opts.selector)
  await el.screenshot({ path: out })
} else if (opts.full) {
  await page.evaluate(() => window.scrollTo(0, 0))
  await new Promise((r) => setTimeout(r, Number(opts.wait ?? 1500)))
  await page.screenshot({ path: out, fullPage: true, captureBeyondViewport: true })
} else {
  await new Promise((r) => setTimeout(r, Number(opts.wait ?? 1500)))
  await page.screenshot({ path: out })
}
await browser.close()
console.log('ok', out)
