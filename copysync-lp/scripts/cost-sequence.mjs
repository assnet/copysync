// Sequência do bloco de custo: rola devagar até a lista e fotografa a entrada dos cartões e o total somando.
import puppeteer from 'puppeteer-core'
const [url = 'http://localhost:4173/', out = 'qa'] = process.argv.slice(2)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const state = (p) => p.evaluate(() => ({
  total: document.querySelector('[data-cost-total] [aria-hidden]')?.textContent,
  selo: !!document.querySelector('[data-cost-priceless]'),
  cartoes: [...document.querySelectorAll('[data-cost-card]')].map((c) => getComputedStyle(c).opacity.slice(0, 4)).join(' '),
  barra: getComputedStyle(document.querySelector('[data-cost-total]')).opacity.slice(0, 4),
  // a barra (visível) nunca pode ficar por cima de um cartão
  cobre: (() => {
    const bar = document.querySelector('[data-cost-total]'); const r = bar.getBoundingClientRect()
    if (+getComputedStyle(bar).opacity < 0.05) return false
    return [...document.querySelectorAll('[data-cost-card]')].some((c) => { const q = c.getBoundingClientRect(); return !(r.bottom <= q.top || r.top >= q.bottom) })
  })(),
  largura: document.documentElement.scrollWidth,
}))
async function open(w, reduce) {
  const mobile = w < 768
  const p = await (await b.createBrowserContext()).newPage()
  await p.setViewport({ width: w, height: mobile ? 844 : 900, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile })
  if (reduce) await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await p.evaluateOnNewDocument(() => localStorage.setItem('cs-consent', 'denied'))
  await p.goto(url, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => Object.keys(document.getElementById('root')).some((k) => k.startsWith('__react')))
  await p.evaluate(() => (document.documentElement.style.scrollBehavior = 'auto'))
  return p
}
for (const w of [390, 1440]) {
  const p = await open(w)
  const top = await p.evaluate(() => document.querySelector('#custo ul').getBoundingClientRect().top + scrollY)
  const vh = await p.evaluate(() => innerHeight)
  // chega pouco antes da lista
  for (let y = 0; y < top - vh; y += 700) { await p.evaluate((y) => scrollTo(0, y), y); await wait(30) }
  console.log(w, 'antes', JSON.stringify(await state(p)))
  let shot = 0
  // rola em passos de 140 px a cada 120 ms (rolagem humana) e fotografa
  for (let y = top - vh; y < top + (w < 768 ? 1500 : 520); y += 140) {
    await p.evaluate((y) => scrollTo(0, y), y)
    await wait(120)
    const s = await state(p)
    console.log(w, `y+${Math.round(y - top + vh)}`, JSON.stringify(s))
    if (shot < 10 && y > top - vh * 0.75) await p.screenshot({ path: `${out}/custo-seq-${w}-${++shot}.png` })
  }
  await wait(1200)
  console.log(w, 'final', JSON.stringify(await state(p)))
  await p.screenshot({ path: `${out}/custo-seq-${w}-final.png` })
  // comparação + botão
  await p.evaluate(() => document.querySelector('#custo .bg-brand').scrollIntoView({ block: 'center' }))
  await wait(400)
  await p.screenshot({ path: `${out}/custo-comparacao-${w}.png` })
  await p.close()
}
// rolagem rápida (pulo direto para depois da lista): nada pode ficar escondido
{
  const p = await open(390)
  await p.evaluate(() => scrollTo(0, document.querySelector('#planos').getBoundingClientRect().top + scrollY))
  await wait(4000)
  console.log('pulo direto', JSON.stringify(await state(p)))
  await p.close()
}
{
  const p = await open(390, true)
  await p.evaluate(() => document.querySelector('#custo ul').scrollIntoView())
  await wait(800)
  console.log('reduzir movimento', JSON.stringify(await state(p)))
  await p.close()
}
await b.close()
