// Capturas específicas de QA.
// uso: node scripts/shots-extra.mjs <base-prod> <base-dev> <pasta-saida>
import puppeteer from 'puppeteer-core'

const [prod, dev, out] = process.argv.slice(2)
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function open(url, width, scale = 1) {
  const mobile = width < 768
  const page = await browser.newPage()
  await page.setViewport({ width, height: mobile ? 844 : 900, deviceScaleFactor: scale, isMobile: mobile, hasTouch: mobile })
  await page.goto(url, { waitUntil: 'networkidle0' })
  await page.evaluate(() => (document.documentElement.style.scrollBehavior = 'auto'))
  await wait(1500)
  return page
}

for (const [w, s] of [[390, 2], [1440, 1]]) {
  // dobra do hero (linha de identificação com a Shein)
  let p = await open(prod, w, s)
  await p.screenshot({ path: `${out}/dobra-${w}.png` })
  // demonstração, etapa 2 (Conecte seus links) completa
  await p.evaluate(() => {
    const el = document.querySelector('#demonstracao .relative.mx-auto.mt-12')
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 24)
  })
  await wait(600)
  await p.evaluate(() => [...document.querySelectorAll('#demonstracao nav button')][1].click())
  await wait(3800)
  await p.screenshot({ path: `${out}/demo-etapa2-${w}.png` })
  await p.close()

  // teste do borrão
  p = await open(`${prod}/?borrao=1`, w, s)
  await p.screenshot({ path: `${out}/borrao-dobra-${w}.png` })
  await p.close()

  // prévia do aviso de cookies (servidor de desenvolvimento)
  p = await open(`${dev}/?cookies=previa`, w, s)
  await wait(1500)
  await p.screenshot({ path: `${out}/cookies-previa-${w}.png` })
  await p.close()
}
await browser.close()
console.log('ok')
