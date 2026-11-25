// Hero: (1) rolagem até a transição para o bloco 2, (2) "reduzir movimento" = estado final parado,
// (3) destinos dos links, (4) o palco pausa fora da tela.
import puppeteer from 'puppeteer-core'
const [url = 'http://localhost:4173/', out = 'qa/hero'] = process.argv.slice(2)
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const mk = async () => { const p = await (await b.createBrowserContext()).newPage(); await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); return p }
{
  const p = await mk()
  await p.goto(url, { waitUntil: 'networkidle0' })
  await p.evaluate(() => scrollTo(0, 420)); await new Promise((r) => setTimeout(r, 700))
  await p.screenshot({ path: `${out}/hero-rolado-420.png` })
  console.log('links:', await p.evaluate(() => [...document.querySelectorAll('#topo a')].map((a) => `${a.textContent.trim()} → ${a.getAttribute('href')} (${document.querySelector(a.getAttribute('href')) ? 'existe' : 'NÃO EXISTE'})`)))
  await p.evaluate(() => scrollTo(0, 2000)); await new Promise((r) => setTimeout(r, 400))
  console.log('palco pausado fora da tela:', await p.evaluate(() => document.querySelector('.swap-stage').hasAttribute('data-paused')))
}
{
  const p = await mk()
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await p.goto(url, { waitUntil: 'networkidle0' })
  console.log('reduzir movimento: animações rodando =', await p.evaluate(() => document.getAnimations().filter((a) => a.effect?.target?.closest?.('.swap-stage')).length),
    '· VOCÊ visível =', await p.evaluate(() => getComputedStyle(document.querySelector('.swap-in')).opacity), '· OUTRO no cartão =', await p.evaluate(() => getComputedStyle(document.querySelector('.swap-out')).opacity))
  await (await p.$('.swap-stage')).screenshot({ path: `${out}/palco-reduzir-movimento.png` })
}
await b.close()
