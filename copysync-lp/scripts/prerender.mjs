// Injeta o HTML pré-renderizado em dist/index.html e pré-carrega as fontes do primeiro paint.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(import.meta.dirname, '..')
const dist = path.join(root, 'dist')
const ssr = path.join(root, 'dist-ssr')
const { render } = await import(pathToFileURL(path.join(ssr, 'entry-server.js')).href)

let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
const fonts = fs
  .readdirSync(path.join(dist, 'assets'))
  .filter((f) => /^(inter-tight-latin-wght-normal|inter-latin-wght-normal)-.*\.woff2$/.test(f))
const preload = fonts
  .map((f) => `<link rel="preload" href="/assets/${f}" as="font" type="font/woff2" crossorigin>`)
  .join('\n    ')

html = html.replace('</title>', `</title>\n    ${preload}`)
html = html.replace('<div id="root"></div>', `<div id="root">${render()}</div>`)

// CSS embutido no HTML (~13 KB gzip): o primeiro paint não espera outra requisição.
html = html.replace(/<link rel="stylesheet" crossorigin href="(\/assets\/[^"]+\.css)">/, (_, href) => {
  const file = path.join(dist, href)
  const css = fs.readFileSync(file, 'utf8')
  fs.rmSync(file) // já está embutido no HTML
  return `<style>${css}</style>`
})
// O HTML já está pronto: o JS (hidratação + animações) só começa a baixar depois do primeiro paint,
// para não disputar banda com o conteúdo visível no 4G.
html = html.replace(/<script type="module" crossorigin src="(\/assets\/[^"]+\.js)"><\/script>/, (_, src) => {
  // Depois do 1º quadro pintado (rAF duplo) ou, em aba em segundo plano (onde rAF não roda), após 1,2 s.
  return `<script>(function(){var d=0;function go(){if(d)return;d=1;var s=document.createElement('script');s.type='module';s.crossOrigin='';s.src='${src}';document.head.appendChild(s)}requestAnimationFrame(function(){requestAnimationFrame(function(){setTimeout(go,0)})});setTimeout(go,1200)})()</script>`
})
if (!html.includes('setTimeout(go,1200)')) throw new Error('script de entrada não encontrado')
fs.writeFileSync(path.join(dist, 'index.html'), html)
fs.rmSync(ssr, { recursive: true, force: true })
console.log('prerender ok · fontes pré-carregadas:', fonts.join(', '))
