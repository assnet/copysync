// Hero → bloco 2: escurecimento ao abrir, prints da prova carregando só perto da tela, erros no console,
// e prints da transição (hero rolado até o bloco seguinte).
import puppeteer from 'puppeteer-core'
const [url = 'http://localhost:4173/', out = 'qa/hero'] = process.argv.slice(2)
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
for (const [w, h] of [[390, 844], [390, 740], [390, 664], [390, 640], [360, 640], [768, 1024], [1440, 900]]) {
  const m = w < 768
  const p = await (await b.createBrowserContext()).newPage()
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: m, hasTouch: m })
  const prints = []
  const errors = []
  p.on('request', (r) => /print-(sapatilha|notebook)/.test(r.url()) && prints.push(r.url().match(/print-[a-z]+/)[0]))
  p.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text().slice(0, 120)))
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 120)))
  await p.goto(url, { waitUntil: 'networkidle0' })
  await wait(800)
  const st = await p.evaluate(() => {
    const lo = document.querySelector('.mix-blend-multiply.fixed')
    return { hero: document.querySelector('#topo').offsetHeight, escuro: lo ? getComputedStyle(lo).visibility + ' ' + getComputedStyle(lo).backgroundColor : 'sem camada' }
  })
  const printsAoAbrir = prints.length
  // rola até a lista de prints chegar perto e confere que carregaram
  await p.evaluate(() => document.querySelector('#prova ul').scrollIntoView({ block: 'center' }))
  await wait(1500)
  const ok = await p.evaluate(() => [...document.querySelectorAll('#prova ul img')].map((i) => i.complete && i.naturalWidth))
  console.log(`${w}x${h}: hero ${st.hero}px · escurecimento ao abrir: ${st.escuro} · prints ao abrir: ${printsAoAbrir} · depois de rolar: ${prints.length} (larguras ${ok}) · erros: ${errors.length ? errors.join(' | ') : 'nenhum'}`)
  if (w === 390 && h === 844) {
    // transição: rola até o fim do hero ficar no meio da tela
    await p.evaluate(() => scrollTo(0, 0)); await wait(300)
    for (const y of [300, 520]) {
      await p.evaluate((y) => scrollTo(0, y), y); await wait(900)
      await p.screenshot({ path: `${out}/transicao-${y}.png` })
    }
  }
  await p.close()
}
await b.close()
