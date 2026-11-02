/**
 * Gera os recursos gráficos da listagem da Chrome Web Store em `store-assets/`
 * a partir do logo da marca (`app/public/assets/brand/logo-512.png`):
 *  - icon-128.png      ícone da loja (arte 96px + 16px de margem transparente, diretriz do Chrome)
 *  - promo-440x280.png bloco promocional pequeno (obrigatório)
 *  - marquee-1400x560.png bloco promocional de letreiro (opcional)
 * Usa o `sharp` instalado em `../api`. Uso: `pnpm store:assets`.
 * Capturas de tela (1280×800) não são geradas aqui: são prints reais do painel.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(path.resolve('../api/package.json'));
const sharp = require('sharp');

const LOGO = path.resolve('../app/public/assets/brand/logo-512.png');
const OUT = 'store-assets';
const BG = '#0f1117';
const NAME = 'CopySync';
const TAGLINE = ['Sessão de afiliado do Mercado Livre', 'sincronizada com o painel'];
mkdirSync(OUT, { recursive: true });

const svgText = (w, h, nameSize, tagSize, x) => {
  const gap = tagSize * 1.4;
  const total = nameSize + gap * TAGLINE.length;
  const top = (h - total) / 2 + nameSize * 0.85;
  const font = 'font-family="-apple-system, Helvetica, Arial, sans-serif"';
  const lines = TAGLINE.map((t, i) =>
    `<text x="${x}" y="${top + gap * (i + 1)}" ${font} font-size="${tagSize}" fill="#9096a8">${t}</text>`).join('');
  return Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <text x="${x}" y="${top}" ${font} font-size="${nameSize}" font-weight="800" fill="#ffffff" letter-spacing="-1">${NAME}</text>
  ${lines}</svg>`);
};

const tile = async (w, h, logoSize, nameSize, tagSize, file, left) => {
  const pad = Math.round((h - logoSize) / 2);
  const logo = await sharp(LOGO).resize(logoSize, logoSize).png().toBuffer();
  const textX = left + logoSize + Math.round(logoSize * 0.25);
  await sharp({ create: { width: w, height: h, channels: 3, background: BG } })
    .composite([
      { input: logo, left, top: pad },
      { input: svgText(w, h, nameSize, tagSize, textX), left: 0, top: 0 },
    ])
    .flatten({ background: BG }).removeAlpha() // 24 bits, sem alfa (exigência da loja)
    .png()
    .toFile(path.join(OUT, file));
  console.log(`✔ ${OUT}/${file}`);
};

// Ícone 128: arte 96 centrada, margem 16 transparente.
await sharp({ create: { width: 128, height: 128, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: await sharp(LOGO).resize(96, 96).png().toBuffer(), left: 16, top: 16 }])
  .png()
  .toFile(path.join(OUT, 'icon-128.png'));
console.log(`✔ ${OUT}/icon-128.png`);

await tile(440, 280, 124, 36, 14, 'promo-440x280.png', 36);
await tile(1400, 560, 320, 104, 36, 'marquee-1400x560.png', 120);
