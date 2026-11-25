// Grava a rolagem da página (de cima até depois do Bloco 2) em MP4.
// uso: node scripts/scroll-video.mjs <url> <saida.mp4> <largura> [--reduce]
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const [url, out, widthArg, ...flags] = process.argv.slice(2)
const width = Number(widthArg)
const mobile = width < 768
const height = mobile ? 844 : 900
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-frames-'))
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const page = await browser.newPage()
await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile })
// já responde o aviso de cookies para ele não cobrir a gravação
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('cs-consent', 'denied') } catch {} })
if (flags.includes('--reduce')) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
await page.goto(url, { waitUntil: 'networkidle0' })
await page.evaluate(() => (document.documentElement.style.scrollBehavior = 'auto'))
await new Promise((r) => setTimeout(r, 1200))

// do topo até o fim do Bloco 3 (passa pela entrada e pela saída do Bloco 2)
const end = await page.evaluate(() => {
  const m = document.getElementById('mecanismo')
  return m.offsetTop + m.offsetHeight - innerHeight * 0.6
})
const fps = 15
const seconds = mobile ? 16 : 13
const frames = fps * seconds
for (let i = 0; i <= frames; i++) {
  const t = i / frames
  const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
  await page.evaluate((y) => window.scrollTo(0, y), Math.round(end * eased))
  await new Promise((r) => setTimeout(r, 1000 / fps))
  await page.screenshot({ path: path.join(dir, `f${String(i).padStart(4, '0')}.png`) })
}
await browser.close()
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(dir, 'f%04d.png'), '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', out])
fs.rmSync(dir, { recursive: true, force: true })
console.log('ok', out)
