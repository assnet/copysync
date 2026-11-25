// Testa os clipes: nada de vídeo no carregamento inicial, carga perto da tela, autoplay mudo em loop,
// versão certa por largura; mede os espaços em volta do bloco escuro e tira capturas das seções novas.
import puppeteer from 'puppeteer-core'
const [url, out] = process.argv.slice(2)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
for (const w of [390, 1440]) {
  const mobile = w < 768
  const ctx = await b.createBrowserContext()
  const p = await ctx.newPage()
  await p.setViewport({ width: w, height: mobile ? 844 : 900, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile })
  await p.evaluateOnNewDocument(() => localStorage.setItem('cs-consent', 'granted'))
  const videos = []
  p.on('request', (r) => { if (/\.(mp4|webm)$/.test(r.url())) videos.push({ url: r.url().split('/').pop(), at: Date.now() }) })
  await p.goto(url, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => Object.keys(document.getElementById('root')).some((k) => k.startsWith('__react')))
  await p.evaluate(() => (document.documentElement.style.scrollBehavior = 'auto'))
  await wait(800)
  const atLoad = videos.length
  const res = { largura: w, videosNoCarregamento: atLoad }
  // espaços em volta do bloco escuro (com o painel já "subido")
  res.espacos = await p.evaluate(async () => {
    const sec = document.getElementById('problema')
    const panel = sec.querySelector('.bg-navy')
    window.scrollTo(0, sec.offsetTop - innerHeight * 0.3); await new Promise((r) => setTimeout(r, 400))
    const hero = document.getElementById('topo') || document.querySelector('section')
    const heroContent = hero.querySelector('.max-w-6xl')
    const pr = panel.getBoundingClientRect()
    const heroBottom = [...hero.querySelectorAll('p,div')].reduce((m, e) => Math.max(m, e.getBoundingClientRect().bottom), 0)
    window.scrollTo(0, sec.offsetTop + sec.offsetHeight - innerHeight * 0.6); await new Promise((r) => setTimeout(r, 400))
    const pr2 = panel.getBoundingClientRect()
    const mt = document.getElementById('mecanismo-title').getBoundingClientRect()
    return { antesDoPainel: Math.round(pr.top - heroBottom), depoisDoPainel_ateTituloRota: Math.round(mt.top - pr2.bottom) }
  })
  for (const [sel, name] of [['#mecanismo figure', 'rota-clipe'], ['#prova', 'prova'], ['#demonstracao figure', 'tutorial'], ['#recursos', 'recursos']]) {
    const before = videos.length
    await p.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), sel)
    await wait(2500)
    const st = await p.evaluate((s) => [...document.querySelector(s).querySelectorAll('video')].map((v) => ({ src: (v.currentSrc || '').split('/').pop(), t: +v.currentTime.toFixed(2), paused: v.paused, muted: v.muted, loop: v.loop, inline: v.playsInline })), sel)
    res[name] = { novosPedidos: videos.length - before, videos: st }
    const el = await p.$(sel)
    await el.screenshot({ path: `${out}/${name}-${w}.png` })
  }
  res.totalVideosBaixados = [...new Set(videos.map((v) => v.url))]
  console.log(JSON.stringify(res, null, 1))
  await ctx.close()
}
await b.close()
